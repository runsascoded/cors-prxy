# Cloudflare Workers runtime

## Summary

Add first-class Cloudflare Workers support as a deployment target alongside Lambda. CFW becomes the default runtime — better cold-start performance, global edge deployment, simpler auth model.

## Config changes

### `runtime` field

```typescript
interface CorsProxyConfig {
  // ... existing fields ...

  /** Deployment runtime. Default: "cloudflare" */
  runtime?: "cloudflare" | "lambda"

  /** Cloudflare-specific config (when runtime is "cloudflare") */
  cloudflare?: {
    /** CF account ID. Can also be set via CLOUDFLARE_ACCOUNT_ID env var. */
    accountId?: string
    /** Worker name. Defaults to config `name`. */
    workerName?: string
    /** Custom route pattern, e.g. "proxy.example.com/*". Optional — uses workers.dev by default. */
    route?: string
    /** Compatibility date. Default: "2024-01-01" */
    compatibilityDate?: string
  }
}
```

When `runtime` is `"lambda"` (or unset in legacy configs that already have `region`), behavior is unchanged. When `runtime` is `"cloudflare"` (or unset and no `region`), deploy as a CF Worker.

### Default runtime detection

- If `runtime` is set explicitly: use it
- If `region` is set but `runtime` is not: assume `"lambda"` (backwards compat)
- Otherwise: default to `"cloudflare"`

## CLI behavior

No new subcommands. Existing commands dispatch on runtime:

| Command | Lambda | Cloudflare |
|---------|--------|------------|
| `deploy` | Create/update Lambda + Function URL + IAM role | Create/update CF Worker via API |
| `destroy` | Delete Lambda + IAM role | Delete CF Worker |
| `status` | Query Lambda tags | Query CF Worker metadata |
| `logs` | CloudWatch Logs | `wrangler tail` or CF API |
| `ls` | Scan tagged Lambdas | Scan CF Workers by naming convention / tags |
| `dev` | Local HTTP server (unchanged) | Local HTTP server (unchanged) |

`ls` scans both backends by default. `--runtime lambda|cloudflare` flag to filter.

## CF Workers deploy implementation

### Auth

CF API token via `CLOUDFLARE_API_TOKEN` env var (same as wrangler). Account ID from config or `CLOUDFLARE_ACCOUNT_ID` env var.

No CF SDK needed — the CF API is simple enough to call via `fetch`:
- `PUT /client/v4/accounts/{account_id}/workers/scripts/{script_name}` — upload worker
- `GET /client/v4/accounts/{account_id}/workers/scripts/{script_name}` — check existence
- `DELETE /client/v4/accounts/{account_id}/workers/scripts/{script_name}` — delete
- `GET /client/v4/accounts/{account_id}/workers/scripts` — list workers
- `PUT /client/v4/accounts/{account_id}/workers/scripts/{script_name}/subdomain` — enable workers.dev subdomain

### Worker bundle

The worker code is the same `handler.ts` logic, wrapped in a CF Workers entry point:

```typescript
import { handleProxyRequest } from "./handler.js"

const config = CONFIG_JSON // replaced at bundle time by esbuild `define`

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const result = await handleProxyRequest({
      method: request.method,
      url: url.pathname + url.search,
      origin: request.headers.get("origin") ?? undefined,
      ip: request.headers.get("cf-connecting-ip") ?? undefined,
      body: request.body,
      headers: Object.fromEntries(request.headers.entries()),
    }, config)
    return new Response(result.body as BodyInit, {
      status: result.status,
      headers: result.headers,
    })
  },
}
```

Bundle with esbuild, inject config as a `define` constant (similar to Lambda's env var approach but baked into the bundle — CF Workers don't have a great env var story for large configs).

### Upload format

CF Workers API expects a multipart form upload with:
- `metadata` part: JSON with `{ "main_module": "index.mjs", "compatibility_date": "..." }`
- `index.mjs` part: the bundled worker code

### Endpoint

After deploy, the worker is available at `https://{worker-name}.{account-subdomain}.workers.dev`. The deploy command prints this URL.

### Worker metadata / discovery

For `ls` to discover CF Workers deployed by cors-prxy, embed metadata in the worker script name or use the CF Workers API to list scripts and check for a naming convention: `cors-prxy-{name}`.

## New files

```
src/
  cloudflare.ts      # CF Workers entry point (bundled + uploaded)
  deploy-cf.ts       # CF API interactions (deploy, destroy, list)
scripts/
  bundle-cloudflare.js  # esbuild bundler for CF Worker
```

`deploy.ts` becomes `deploy-lambda.ts` (rename for clarity), and `deploy.ts` becomes a dispatcher:

```typescript
export async function deploy(config: CorsProxyConfig) {
  const runtime = resolveRuntime(config)
  if (runtime === "cloudflare") {
    const { deployCf } = await import("./deploy-cf.js")
    return deployCf(config)
  }
  const { deployLambda } = await import("./deploy-lambda.js")
  return deployLambda(config)
}
```

Same pattern for `destroy`.

## `ls` across runtimes

```sh
cors-prxy ls                    # list all (both runtimes)
cors-prxy ls --runtime lambda   # Lambda only
cors-prxy ls --runtime cloudflare  # CF only
```

Output table adds a RUNTIME column:

```
NAME              RUNTIME      ENDPOINT                                    ALLOW
aws-static-sso    cloudflare   https://cors-prxy-aws-static-sso.x.workers.dev  oidc.*.amazonaws.com
og-crd            lambda       https://abc123.lambda-url.us-east-1.on.aws      github.com
```

## Migration path

Existing `.cors-prxy.json` configs without `runtime` that have `region` set continue to deploy as Lambda (backwards compat). New configs default to Cloudflare.

To migrate an existing Lambda proxy to CF:
1. Add `"runtime": "cloudflare"` + `cloudflare.accountId` to config
2. `cors-prxy deploy`
3. Update consumers to new endpoint
4. `cors-prxy destroy --runtime lambda` to clean up old Lambda

## Environment variables

| Var | Description |
|-----|-------------|
| `CLOUDFLARE_API_TOKEN` | CF API token (same as wrangler) |
| `CLOUDFLARE_ACCOUNT_ID` | CF account ID (fallback if not in config) |
