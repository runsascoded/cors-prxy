import { createServer } from "node:http"
import { handleProxyRequest } from "./handler.js"
import type { CorsProxyConfig } from "./config.js"

function collectBody(req: import("node:http").IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => {
      if (chunks.length === 0) return resolve(null)
      resolve(Buffer.concat(chunks).toString("utf-8"))
    })
    req.on("error", reject)
  })
}

export function startDevServer(config: CorsProxyConfig, port = 3849): void {
  const server = createServer(async (req, res) => {
    const ip = req.socket.remoteAddress ?? "unknown"
    const body = await collectBody(req)

    // Collect headers as flat record
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers[key] = value
    }

    const result = await handleProxyRequest(
      {
        method: req.method ?? "GET",
        url: req.url ?? "/",
        origin: req.headers.origin,
        ip,
        body,
        headers,
      },
      config,
    )

    res.writeHead(result.status, result.headers)
    res.end(result.body)
  })

  const urlMode = config.urlMode ?? "query"
  server.listen(port, () => {
    console.log(`cors-prxy dev server running on http://localhost:${port}`)
    if (urlMode === "query") {
      console.log(`Proxy: http://localhost:${port}/?url=<encoded-url>`)
    } else {
      console.log(`Proxy: http://localhost:${port}/<host>/<path>`)
    }
    console.log(`Allowlist: ${config.allow.map(r => typeof r === "string" ? r : r.domain).join(", ")}`)
  })
}
