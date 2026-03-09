import { handleProxyRequest } from "./handler.js"
import type { CorsProxyConfig } from "./config.js"

const config: CorsProxyConfig = "__CORS_PRXY_CONFIG_PLACEHOLDER__" as unknown as CorsProxyConfig

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const result = await handleProxyRequest(
      {
        method: request.method,
        url: url.pathname + url.search,
        origin: request.headers.get("origin") ?? undefined,
        ip: request.headers.get("cf-connecting-ip") ?? undefined,
        body: request.body,
        headers: Object.fromEntries(request.headers.entries()),
      },
      config,
    )
    return new Response(result.body as BodyInit, {
      status: result.status,
      headers: result.headers,
    })
  },
}
