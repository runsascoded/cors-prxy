import { handleProxyRequest } from "./handler.js"
import type { CorsProxyConfig } from "./config.js"

const config: CorsProxyConfig = JSON.parse(process.env.CORS_PRXY_CONFIG!)

interface LambdaEvent {
  requestContext: {
    http: {
      method: string
      path: string
      sourceIp: string
    }
  }
  rawQueryString: string
  headers: Record<string, string>
  body?: string
  isBase64Encoded?: boolean
}

interface LambdaResponse {
  statusCode: number
  headers: Record<string, string>
  body: string
  isBase64Encoded: boolean
}

export async function handler(event: LambdaEvent): Promise<LambdaResponse> {
  const { method, path, sourceIp } = event.requestContext.http
  const url = `${path}${event.rawQueryString ? `?${event.rawQueryString}` : ""}`

  let body: string | Buffer | null = null
  if (event.body) {
    body = event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body
  }

  const result = await handleProxyRequest(
    {
      method,
      url,
      origin: event.headers["origin"],
      ip: sourceIp,
      body,
      headers: event.headers,
    },
    config,
  )

  return {
    statusCode: result.status,
    headers: result.headers,
    body: typeof result.body === "string" ? result.body : result.body.toString("base64"),
    isBase64Encoded: typeof result.body !== "string",
  }
}
