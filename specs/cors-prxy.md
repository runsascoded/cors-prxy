# cors-prxy

Minimal, security-focused Lambda CORS proxy — deploy per-project allowlisted trampolines via CLI or GitHub Actions.

## Problem

Frontend apps need CORS proxies to fetch OG metadata, RSS feeds, and other cross-origin resources. Public proxies (corsproxy.io, allorigins.win) are unreliable and a security risk. Self-hosting a proxy is easy but repetitive — every project reinvents the same Lambda + API Gateway + allowlist pattern.

## Solution

`cors-prxy` provides:

1. **npm package** (`cors-prxy`) with a CLI for deploying/managing per-project Lambda proxies
2. **Reusable GitHub Action** for CI-managed deploys, so shared infra is only mutated via public GHA logs

## Design principles

- **Minimal attack surface**: each proxy only allows requests to explicitly configured domains/paths
- **Per-project isolation**: each project gets its own Lambda + config, not a shared global proxy
- **Declarative config**: `.cors-prxy.json` in project root defines the allowlist
- **Infra-as-code via GHA**: the "source of truth" for deployed proxies is the config committed to repos, applied via GHA
- **Resource tagging**: all AWS resources tagged with `cors-prxy` metadata for discovery and management

## Config: `.cors-prxy.json`

```json
{
  "name": "og-crd",
  "region": "us-east-1",
  "allow": [
    "github.com",
    "*.github.com",
    { "domain": "api.example.com", "paths": ["/v1/og/*"] }
  ],
  "rateLimit": {
    "perIp": 60,
    "window": "1m"
  },
  "cors": {
    "origins": ["https://og-crd.rbw.sh", "http://localhost:*"],
    "maxAge": 86400
  },
  "cache": {
    "ttl": 300,
    "maxSize": 1000
  },
  "tags": {
    "project": "og-crd",
    "environment": "production"
  }
}
```

### Config fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | `string` | (required) | Lambda function name, used as resource identifier |
| `region` | `string` | `us-east-1` | AWS region |
| `allow` | `(string \| AllowRule)[]` | (required) | Allowlisted domains/paths |
| `rateLimit` | `object` | `{ perIp: 60, window: "1m" }` | Per-IP rate limiting |
| `cors.origins` | `string[]` | `["*"]` | Allowed CORS origins |
| `cors.maxAge` | `number` | `86400` | `Access-Control-Max-Age` (seconds) |
| `cache.ttl` | `number` | `300` | Response cache TTL (seconds) |
| `cache.maxSize` | `number` | `1000` | Max cached responses (LRU) |
| `tags` | `Record<string, string>` | `{}` | Additional AWS resource tags (merged with auto-tags) |

### `AllowRule`

- `string` — domain glob, e.g. `"github.com"`, `"*.github.com"`
- `{ domain, paths }` — domain + path globs, e.g. `{ "domain": "api.example.com", "paths": ["/v1/*"] }`

All non-matching requests return `403 Forbidden` with a clear error message.

## AWS resource tagging

All resources (Lambda, IAM role, etc.) are tagged with:

| Tag | Value | Description |
|-----|-------|-------------|
| `cors-prxy` | `true` | Marker tag for discovery |
| `cors-prxy:name` | config `name` | Proxy name |
| `cors-prxy:version` | package version | `cors-prxy` version that deployed it |
| `cors-prxy:allow` | compact allowlist | e.g. `github.com,*.github.com` |
| `cors-prxy:repo` | repo URL | Source repo (auto-detected from git remote, or GHA context) |
| + user `tags` | | Merged in from config |

This enables:

```sh
# List all cors-prxy Lambdas in current account
cors-prxy ls

# Output:
# NAME        ENDPOINT                                              ALLOW                    REPO
# og-crd      https://abc123.lambda-url.us-east-1.on.aws            github.com,*.github.com  runsascoded/og-crd
# my-app      https://def456.lambda-url.us-east-1.on.aws            api.example.com          runsascoded/my-app
```

`cors-prxy ls` queries Lambda functions tagged `cors-prxy=true` across configured regions. No local state file needed for discovery — the tags *are* the state.

## CLI

```sh
# Install as devDependency
pnpm add -D cors-prxy

# Deploy (create or update)
cors-prxy deploy              # reads .cors-prxy.json
cors-prxy deploy -c custom.json

# List all cors-prxy Lambdas in current AWS account
cors-prxy ls                  # table of all proxies, endpoints, allowlists
cors-prxy ls -r us-east-1,eu-west-1  # specific regions
cors-prxy ls --json           # JSON output

# Status / info for current project's proxy
cors-prxy status              # show deployed Lambda info + endpoint URL

# Logs
cors-prxy logs                # tail Lambda logs (CloudWatch)

# Destroy
cors-prxy destroy             # remove Lambda + IAM role

# Local dev server (for testing without deploying)
cors-prxy dev                 # local proxy on :3849, same allowlist rules
```

### CLI details

- Uses AWS SDK v3 directly (no CDK/SAM/Terraform dependency)
- Creates: Lambda function, Lambda function URL (no API Gateway needed — simpler, cheaper), IAM execution role
- Lambda runtime: Node.js 22.x, ESM
- `deploy` is idempotent: creates if missing, updates config/code if changed, no-ops if unchanged
- No local state file required — `ls` and `status` discover resources via tags

## Reusable GitHub Action

```yaml
# .github/workflows/cors-proxy.yml
name: CORS Proxy
on:
  push:
    branches: [main]
    paths: ['.cors-prxy.json']
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write  # OIDC for AWS
    steps:
      - uses: actions/checkout@v4
      - uses: runsascoded/cors-prxy@v1
        with:
          config: .cors-prxy.json
          aws-role-arn: ${{ secrets.AWS_ROLE_ARN }}
          # or:
          # aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          # aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

### GHA design

- Runs on pushes that change `.cors-prxy.json` (config drift = auto-redeploy)
- Supports both OIDC (`id-token: write`) and static credentials
- Outputs the proxy endpoint URL as a step output + job summary annotation
- `workflow_dispatch` for manual redeploy/verification
- The GHA is the same `deploy` logic as the CLI, just wrapped in action.yml

## Lambda implementation

The Lambda itself is tiny (~50 LOC):

```
Request: GET /?url=<encoded-url>
  1. Parse + validate URL against allowlist
  2. If denied → 403 { error: "Domain not allowed", allowed: [...] }
  3. Check in-memory cache (LRU) → return if hit
  4. Fetch upstream URL
  5. Return response with CORS headers, cache result
```

### Request flow

```
Browser → Lambda Function URL → Upstream
         (allowlist check)      (fetch + cache)
         (CORS headers)
         (rate limit)
```

### Response headers

```
Access-Control-Allow-Origin: <from config>
Access-Control-Allow-Methods: GET, HEAD, OPTIONS
Access-Control-Max-Age: <from config>
Cache-Control: public, max-age=<ttl>
X-Cors-Prxy: <function-name>
```

### Security

- **Domain allowlist**: only configured domains are proxied, glob matching
- **Path allowlist**: optional per-domain path restrictions
- **Rate limiting**: per-IP, in-memory (resets on cold start, which is fine for abuse prevention)
- **No mutation**: only `GET` and `HEAD` requests are proxied
- **Size limit**: responses >5MB are rejected (prevents abuse as a file proxy)
- **Timeout**: 10s upstream fetch timeout
- **No cookies/auth forwarding**: request headers are not forwarded (prevents credential leaking)

## Project structure

```
cors-prxy/
  src/
    cli.ts           # CLI entry point
    deploy.ts        # AWS Lambda + Function URL CRUD
    lambda.ts        # Lambda handler source (bundled + deployed)
    config.ts        # Config parsing + validation
    allowlist.ts     # Domain/path glob matching
    cache.ts         # Simple LRU cache
    tags.ts          # AWS resource tagging + discovery
    dev-server.ts    # Local dev proxy (same logic as Lambda)
  action.yml         # GitHub Action definition
  .github/
    workflows/
      ci.yml         # Test + build
  package.json
  tsconfig.json
```

## Usage in og-crd

Once `cors-prxy` exists, `og-crd` would:

1. Add `.cors-prxy.json`:
   ```json
   {
     "name": "og-crd",
     "allow": ["github.com", "*.github.com"],
     "cors": { "origins": ["https://og-crd.rbw.sh", "http://localhost:*"] }
   }
   ```

2. Add GHA workflow for auto-deploy

3. Update demo to use own proxy endpoint instead of corsproxy.io:
   ```tsx
   const PROXY = "https://<lambda-url>.lambda-url.us-east-1.on.aws/?url="
   ```

4. Demo can show both modes:
   - **Static cards** (pre-fetched at build time, no proxy needed)
   - **Dynamic cards** (fetched at runtime via own `cors-prxy` Lambda)
   - Side by side, visually identical, with source links

## npm name

`cors-prxy` is available on npm.

## Open questions

- **Custom domain support?** Lambda Function URLs are ugly (`*.lambda-url.*.on.aws`). Could support optional custom domain via Route 53 + ACM cert, but adds complexity. Maybe v2.
- **Shared proxy option?** Some users may want a single proxy for multiple projects. Could support a `shared: true` mode that merges allowlists. But per-project isolation is safer as default.
- **Monitoring/alerts?** CloudWatch alarms for error rates / throttling. Nice to have, not MVP.
- **Multiple regions?** For latency. Probably overkill for v1.
