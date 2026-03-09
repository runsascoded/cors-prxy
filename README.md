# cors-prxy

Minimal, security-focused Lambda CORS proxy — deploy per-project allowlisted trampolines via CLI or GitHub Actions.

## Why

Frontend apps need CORS proxies to fetch OG metadata, RSS feeds, and other cross-origin resources. Public proxies are unreliable and a security risk. Self-hosting is easy but repetitive — every project reinvents the same Lambda + allowlist pattern.

`cors-prxy` gives each project its own Lambda proxy with an explicit domain allowlist, deployed via CLI or GitHub Actions.

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

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | `string` | (required) | Lambda function name / resource identifier |
| `region` | `string` | `us-east-1` | AWS region |
| `allow` | `(string \| AllowRule)[]` | (required) | Allowlisted domains/paths |
| `rateLimit.perIp` | `number` | `60` | Max requests per IP per window |
| `rateLimit.window` | `string` | `"1m"` | Rate limit window (`"30s"`, `"1m"`, `"1h"`) |
| `cors.origins` | `string[]` | `["*"]` | Allowed CORS origins (globs) |
| `cors.maxAge` | `number` | `86400` | `Access-Control-Max-Age` in seconds |
| `cache.ttl` | `number` | `300` | Response cache TTL in seconds |
| `cache.maxSize` | `number` | `1000` | Max cached responses (LRU) |
| `tags` | `Record<string, string>` | `{}` | Additional AWS resource tags |

### Allow rules

- **String** — domain glob: `"github.com"`, `"*.github.com"`
- **Object** — domain + path globs: `{ "domain": "api.example.com", "paths": ["/v1/*"] }`

All non-matching requests return `403`.

## CLI

```sh
cors-prxy deploy              # create or update Lambda proxy
cors-prxy deploy -c custom.json

cors-prxy ls                  # list all cors-prxy Lambdas in account
cors-prxy ls -r us-east-1,eu-west-1
cors-prxy ls --json

cors-prxy status              # show current project's proxy info
cors-prxy logs                # tail CloudWatch logs
cors-prxy logs -f             # follow

cors-prxy destroy             # remove Lambda + IAM role
cors-prxy destroy -y          # skip confirmation

cors-prxy dev                 # local proxy on :3849
cors-prxy dev -p 4000         # custom port
```

### What `deploy` creates

- **Lambda function** (Node.js 22.x, ESM) with a [Function URL] (no API Gateway)
- **IAM execution role** with CloudWatch Logs permissions
- All resources tagged for discovery (no local state file needed)

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
Browser → Lambda Function URL → Upstream
         (allowlist check)      (fetch + cache)
         (CORS headers)
         (rate limit)
```

Request: `GET /?url=<encoded-url>`

1. Parse + validate URL against allowlist
2. If denied: `403 { error: "Domain not allowed", allowed: [...] }`
3. Check in-memory LRU cache
4. Fetch upstream (10s timeout, 5MB size limit)
5. Return response with CORS headers, cache result

### Response headers

```
Access-Control-Allow-Origin: <matched origin>
Access-Control-Allow-Methods: GET, HEAD, OPTIONS
Access-Control-Max-Age: <from config>
Cache-Control: public, max-age=<ttl>
X-Cors-Prxy: <function-name>
```

### Security

- **Domain allowlist**: only configured domains are proxied, glob matching via [picomatch]
- **Path allowlist**: optional per-domain path restrictions
- **Rate limiting**: per-IP, in-memory (resets on cold start)
- **Read-only**: only `GET` and `HEAD` are proxied
- **Size limit**: responses >5MB rejected
- **Timeout**: 10s upstream fetch timeout
- **No credential forwarding**: request headers/cookies are not forwarded

[picomatch]: https://github.com/micromatch/picomatch

## Resource tagging

All AWS resources are tagged for discovery:

| Tag | Example |
|-----|---------|
| `cors-prxy` | `true` |
| `cors-prxy:name` | `my-app` |
| `cors-prxy:version` | `0.1.0` |
| `cors-prxy:allow` | `github.com,*.github.com` |
| `cors-prxy:repo` | `user/my-app` |

`cors-prxy ls` discovers proxies via these tags — no local state file needed.

## Development

```sh
pnpm install
pnpm build    # tsc + esbuild Lambda bundle
pnpm test     # vitest
```

## License

MIT
