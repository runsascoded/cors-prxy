# cors-prxy

Minimal, security-focused CORS proxy — deploy per-project allowlisted trampolines to Cloudflare Workers or AWS Lambda via CLI or GitHub Actions.

## Why

Frontend apps need CORS proxies to fetch OG metadata, RSS feeds, and other cross-origin resources. Public proxies are unreliable and a security risk. Self-hosting is easy but repetitive — every project reinvents the same proxy + allowlist pattern.

`cors-prxy` gives each project its own proxy with an explicit domain allowlist, deployed via CLI or GitHub Actions.

## Install

```sh
pnpm add -D cors-prxy
```

## Config

Create `.cors-prxy.json` in your project root:

```json
{
  "name": "my-app",
  "allow": [
    "github.com",
    "*.github.com",
    { "domain": "api.example.com", "paths": ["/v1/og/*"] }
  ],
  "cors": {
    "origins": ["https://my-app.example.com", "http://localhost:*"]
  }
}
```

This deploys to **Cloudflare Workers** by default. For AWS Lambda, add `"runtime": "lambda"`.

### Config fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | `string` | (required) | Proxy name / resource identifier |
| `runtime` | `"cloudflare" \| "lambda"` | `"cloudflare"` | Deployment target |
| `allow` | `(string \| AllowRule)[]` | (required) | Allowlisted domains/paths |
| `region` | `string` | `us-east-1` | AWS region (Lambda only) |
| `methods` | `string[]` | `["GET", "HEAD"]` | Allowed HTTP methods (`["*"]` for any) |
| `forwardHeaders` | `string[]` | `[]` | Request headers to forward upstream |
| `urlMode` | `"query" \| "path"` | `"query"` | `?url=` vs `/<host>/<path>` routing |
| `rateLimit.perIp` | `number` | `60` | Max requests per IP per window |
| `rateLimit.window` | `string` | `"1m"` | Rate limit window (`"30s"`, `"1m"`, `"1h"`) |
| `cors.origins` | `string[]` | `["*"]` | Allowed CORS origins (globs) |
| `cors.maxAge` | `number` | `86400` | `Access-Control-Max-Age` in seconds |
| `cache.ttl` | `number` | `300` | Response cache TTL in seconds |
| `cache.maxSize` | `number` | `1000` | Max cached responses (LRU) |
| `tags` | `Record<string, string>` | `{}` | Additional resource tags |

### Cloudflare config

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `cloudflare.accountId` | `string` | `$CLOUDFLARE_ACCOUNT_ID` | CF account ID |
| `cloudflare.workerName` | `string` | `cors-prxy-{name}` | Worker script name |
| `cloudflare.route` | `string` | — | Custom route pattern |
| `cloudflare.compatibilityDate` | `string` | `"2024-01-01"` | CF compatibility date |

### Allow rules

- **String** — domain glob: `"github.com"`, `"*.github.com"`
- **Object** — domain + path globs: `{ "domain": "api.example.com", "paths": ["/v1/*"] }`

All non-matching requests return `403`.

### Full proxy mode

By default, only GET/HEAD are proxied (read-only). For APIs that need POST/PUT/etc:

```json
{
  "name": "my-api-proxy",
  "allow": ["api.example.com"],
  "methods": ["*"],
  "forwardHeaders": ["content-type", "authorization"],
  "urlMode": "path",
  "cache": { "ttl": 0, "maxSize": 0 }
}
```

Request bodies are forwarded automatically for non-GET/HEAD methods. Only configured headers are forwarded — no cookies or credentials leak by default.

## CLI

```sh
cors-prxy deploy              # deploy proxy (CF Workers or Lambda)
cors-prxy deploy -c custom.json

cors-prxy ls                  # list all proxies (both runtimes)
cors-prxy ls --runtime cloudflare
cors-prxy ls --json

cors-prxy status              # show current project's proxy info
cors-prxy logs                # tail logs (CloudWatch for Lambda, wrangler for CF)
cors-prxy logs -f             # follow

cors-prxy destroy             # remove proxy
cors-prxy destroy -y          # skip confirmation

cors-prxy dev                 # local proxy on :3849
cors-prxy dev -p 4000         # custom port
```

### What `deploy` creates

**Cloudflare Workers** (default):
- Worker script on `workers.dev` subdomain
- Requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (or `cloudflare.accountId` in config)

**AWS Lambda**:
- Lambda function (Node.js 22.x, ESM) with a [Function URL] (no API Gateway)
- IAM execution role with CloudWatch Logs permissions
- All resources tagged for discovery

`deploy` is idempotent: creates if missing, updates if changed.

[Function URL]: https://docs.aws.amazon.com/lambda/latest/dg/lambda-urls.html

## GitHub Action

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
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: runsascoded/cors-prxy@v1
        with:
          config: .cors-prxy.json
          aws-role-arn: ${{ secrets.AWS_ROLE_ARN }}
```

Supports both OIDC and static credentials (`aws-access-key-id` / `aws-secret-access-key`).

## How it works

```
Browser → CF Worker / Lambda → Upstream
         (allowlist check)     (fetch + cache)
         (CORS headers)
         (rate limit)
```

Request: `GET /?url=<encoded-url>` (query mode) or `GET /<host>/<path>` (path mode)

1. Parse + validate URL against allowlist
2. If denied: `403 { error: "Domain not allowed", allowed: [...] }`
3. Check in-memory LRU cache (GET/HEAD only)
4. Fetch upstream (10s timeout, 5MB size limit)
5. Return response with CORS headers, cache result

### Security

- **Domain allowlist**: only configured domains are proxied, glob matching via [picomatch]
- **Path allowlist**: optional per-domain path restrictions
- **Rate limiting**: per-IP, in-memory (resets on cold start)
- **Methods**: configurable — read-only by default, opt-in for mutations
- **Header forwarding**: explicit allowlist only — no cookies/credentials forwarded by default
- **Size limit**: responses >5MB rejected
- **Timeout**: 10s upstream fetch timeout

[picomatch]: https://github.com/micromatch/picomatch

## Development

```sh
pnpm install
pnpm build    # tsc + esbuild bundles (Lambda + CF Worker)
pnpm test     # vitest
```

## License

MIT
