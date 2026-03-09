# Full proxy mode: methods, body forwarding, URL routing

## Problem

cors-prxy currently only supports read-only proxying (GET/HEAD, no request body, `?url=` query param). This prevents use cases where the browser needs to proxy mutating API calls through a CORS trampoline — e.g. AWS SSO OIDC device code flow, which requires POST with JSON bodies.

## Motivation

[aws-static-sso] needs a CORS proxy for AWS SSO endpoints that:
- Forwards POST requests with JSON bodies (RegisterClient, StartDeviceAuthorization, CreateToken)
- Forwards specific headers (`content-type`, `x-amz-sso_bearer_token`)
- Uses path-based URL routing (`/oidc.us-east-1.amazonaws.com/client/register`) rather than `?url=`

These are reasonable general-purpose proxy features, not AWS-specific. Making cors-prxy support them means any project can use it as a configurable CORS trampoline for arbitrary APIs, not just read-only resource fetching.

## New config fields

All optional, backwards-compatible defaults match current behavior:

```typescript
interface CorsProxyConfig {
  // ... existing fields ...

  /** Allowed HTTP methods. Default: ["GET", "HEAD"] */
  methods?: string[]

  /** Forward request body for methods that have one (POST, PUT, PATCH). Default: false */
  forwardBody?: boolean

  /** Request headers to forward upstream (lowercase). Default: [] (none forwarded) */
  forwardHeaders?: string[]

  /** How the target URL is specified. Default: "query" */
  urlMode?: "query" | "path"
}
```

### `methods`

- Default: `["GET", "HEAD"]` (current behavior)
- `["*"]` allows any method
- `["GET", "HEAD", "POST"]` allows specific methods
- OPTIONS is always handled (preflight), regardless of this setting
- The CORS `Access-Control-Allow-Methods` header reflects this config

### `forwardBody`

- Default: `false`
- When `true`, the request body is forwarded to the upstream for POST/PUT/PATCH/DELETE
- GET/HEAD never forward a body regardless of this setting

### `forwardHeaders`

- Default: `[]` (no headers forwarded — current behavior)
- List of lowercase header names to copy from the incoming request to the upstream fetch
- The CORS `Access-Control-Allow-Headers` header reflects this config
- `Host` is always rewritten to the target, `Origin` is always stripped (existing behavior should be preserved from aws-static-sso's worker)

### `urlMode`

- `"query"` (default): target URL from `?url=<encoded-url>` query parameter (current behavior)
- `"path"`: target host + path extracted from the request URL path, e.g. `/<host>/<path>`. Search params are passed through.

## Handler changes

### `handleProxyRequest` signature

Add optional `body` and `headers` fields to `ProxyRequest`:

```typescript
interface ProxyRequest {
  method: string
  url: string
  origin?: string
  ip?: string
  body?: string | Buffer | ReadableStream | null   // new
  headers?: Record<string, string>                  // new
}
```

### Method check (handler.ts ~line 90)

```typescript
// Before:
if (req.method !== "GET" && req.method !== "HEAD") { return 405 }

// After:
const allowedMethods = config.methods ?? ["GET", "HEAD"]
if (allowedMethods[0] !== "*" && !allowedMethods.includes(req.method)) { return 405 }
```

### URL parsing (handler.ts ~line 98)

```typescript
const urlMode = config.urlMode ?? "query"
let targetUrl: string
if (urlMode === "query") {
  // existing ?url= logic
} else {
  // path mode: /host/rest/of/path?search
  const reqUrl = new URL(req.url, "http://localhost")
  const match = reqUrl.pathname.match(/^\/([^/]+)(\/.*)?$/)
  if (!match) return 400
  targetUrl = `https://${match[1]}${match[2] || "/"}${reqUrl.search}`
}
```

### Upstream fetch (handler.ts ~line 155)

```typescript
const fetchInit: RequestInit = {
  method: config.forwardBody ? req.method : "GET",
  redirect: "follow",
  signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
}

if (config.forwardBody && req.body && !["GET", "HEAD"].includes(req.method)) {
  fetchInit.body = req.body
}

if (config.forwardHeaders?.length) {
  const headers: Record<string, string> = {}
  for (const name of config.forwardHeaders) {
    const value = req.headers?.[name]
    if (value) headers[name] = value
  }
  // Always set Host to target, strip Origin
  const targetHost = new URL(targetUrl).host
  headers["host"] = targetHost
  delete headers["origin"]
  fetchInit.headers = headers
}
```

### CORS headers (handler.ts ~line 52)

```typescript
function corsHeaders(config: CorsProxyConfig, requestOrigin?: string): Record<string, string> {
  // ... existing origin matching ...

  const methods = config.methods ?? ["GET", "HEAD"]
  const methodStr = methods[0] === "*"
    ? "GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS"
    : [...methods, "OPTIONS"].join(", ")

  const allowHeaders = config.forwardHeaders?.length
    ? config.forwardHeaders.join(", ")
    : ""

  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-methods": methodStr,
    ...(allowHeaders && { "access-control-allow-headers": allowHeaders }),
    "access-control-expose-headers": "*",
    "access-control-max-age": String(config.cors.maxAge),
    "x-cors-prxy": config.name,
  }
}
```

### Caching

- Only cache GET/HEAD responses (regardless of `methods` config)
- POST/PUT/PATCH/DELETE skip cache lookup and cache storage

## Example configs

### Read-only proxy (current default, unchanged)

```json
{
  "name": "og-crd",
  "allow": ["github.com", "*.github.com"]
}
```

### Full API proxy (aws-static-sso)

```json
{
  "name": "aws-static-sso",
  "allow": ["oidc.*.amazonaws.com", "portal.sso.*.amazonaws.com"],
  "methods": ["*"],
  "forwardBody": true,
  "forwardHeaders": ["content-type", "authorization", "x-amz-sso_bearer_token"],
  "urlMode": "path",
  "cache": { "ttl": 0, "maxSize": 0 }
}
```

### Selective method proxy

```json
{
  "name": "my-api",
  "allow": [{ "domain": "api.example.com", "paths": ["/v1/*"] }],
  "methods": ["GET", "POST"],
  "forwardBody": true,
  "forwardHeaders": ["content-type", "authorization"]
}
```

## Cloudflare Workers adapter

This is a separate concern from the config additions above, but worth noting: cors-prxy is currently Lambda-first. A thin CF Workers adapter would make it usable in `aws-static-sso`'s existing worker setup:

```typescript
// cors-prxy/src/cloudflare.ts
import { handleProxyRequest } from "./handler.js"
import type { CorsProxyConfig } from "./config.js"

export function createWorkerHandler(config: CorsProxyConfig) {
  return {
    async fetch(request: Request): Promise<Response> {
      const result = await handleProxyRequest({
        method: request.method,
        url: request.url,
        origin: request.headers.get("origin") ?? undefined,
        ip: request.headers.get("cf-connecting-ip") ?? undefined,
        body: request.body,
        headers: Object.fromEntries(request.headers.entries()),
      }, config)
      return new Response(result.body, {
        status: result.status,
        headers: result.headers,
      })
    },
  } satisfies ExportedHandler
}
```

This could be a separate export path (`cors-prxy/cloudflare`) or just documented usage — the handler is already runtime-agnostic, only `loadConfig` uses Node fs.

## Context

Came up while building [aws-static-sso] — currently has a ~60-line custom worker doing the same thing cors-prxy does, but with POST support and path-based routing. With these additions, the worker becomes:

```typescript
import { createWorkerHandler } from "cors-prxy/cloudflare"
export default createWorkerHandler({ /* config */ })
```

[aws-static-sso]: https://github.com/runsascoded/aws-static-sso
