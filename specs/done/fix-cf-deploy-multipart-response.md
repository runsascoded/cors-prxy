# Fix CF deploy: multipart upload response parsing

## Bug

`cors-prxy deploy` fails in GHA (and likely any non-interactive env) with:

```
SyntaxError: No number after minus sign in JSON at position 1 (line 1 column 2)
    at JSON.parse (<anonymous>)
    ...
    at async deployCf (deploy-cf.js:46:22)
```

The response body starts with `--591155c8b58d...` — a multipart boundary string, not JSON.

## Cause

`cfApi()` unconditionally calls `resp.json()` on every response. The CF Workers upload endpoint (`PUT /accounts/{id}/workers/scripts/{name}`) with a `multipart/form-data` body may return a non-JSON response (or echo the boundary). The function doesn't check `Content-Type` or response status before parsing.

## Fix

In `deploy-cf.ts`, `cfApi` should:
1. Check `response.ok` or at least `Content-Type` before calling `.json()`
2. If the response isn't JSON, read as text and wrap in a structured error
3. Ideally log the raw response body on failure for debugging

```typescript
async function cfApi(path: string, apiToken: string, opts: RequestInit = {}) {
  const resp = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...opts,
    headers: {
      "Authorization": `Bearer ${apiToken}`,
      ...opts.headers as Record<string, string>,
    },
  })
  const contentType = resp.headers.get("content-type") ?? ""
  if (!contentType.includes("application/json")) {
    const text = await resp.text()
    if (!resp.ok) {
      throw new Error(`CF API ${resp.status}: ${text.slice(0, 200)}`)
    }
    // Some success responses may not be JSON
    return { success: resp.ok, result: undefined, errors: [] }
  }
  return resp.json()
}
```

## Reproducer

Deploy from GHA with `CLOUDFLARE_API_TOKEN` secret set:

```yaml
- run: cors-prxy deploy
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

Works locally, fails in GHA. May be a difference in Node.js fetch behavior or CF API response based on request details.

## Context

Hit in https://github.com/runsascoded/aws-static-sso CI — GHA run 22867512771, `deploy-worker` job.
