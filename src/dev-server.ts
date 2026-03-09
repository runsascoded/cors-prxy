import { createServer } from "node:http"
import { handleProxyRequest } from "./handler.js"
import type { CorsProxyConfig } from "./config.js"

export function startDevServer(config: CorsProxyConfig, port = 3849): void {
  const server = createServer(async (req, res) => {
    const ip = req.socket.remoteAddress ?? "unknown"
    const result = await handleProxyRequest(
      {
        method: req.method ?? "GET",
        url: req.url ?? "/",
        origin: req.headers.origin,
        ip,
      },
      config,
    )

    res.writeHead(result.status, result.headers)
    res.end(result.body)
  })

  server.listen(port, () => {
    console.log(`cors-prxy dev server running on http://localhost:${port}`)
    console.log(`Proxy: http://localhost:${port}/?url=<encoded-url>`)
    console.log(`Allowlist: ${config.allow.map(r => typeof r === "string" ? r : r.domain).join(", ")}`)
  })
}
