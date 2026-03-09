import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { handleProxyRequest } from "../handler.js"
import type { CorsProxyConfig } from "../config.js"

const testConfig: CorsProxyConfig = {
  name: "test-proxy",
  region: "us-east-1",
  allow: ["example.com", "*.example.com"],
  rateLimit: { perIp: 60, window: "1m" },
  cors: { origins: ["https://app.example.com"], maxAge: 86400 },
  cache: { ttl: 300, maxSize: 100 },
  tags: {},
}

const fullProxyConfig: CorsProxyConfig = {
  ...testConfig,
  methods: ["*"],
  forwardHeaders: ["content-type", "authorization"],
  urlMode: "path",
  cache: { ttl: 0, maxSize: 0 },
}

describe("handleProxyRequest", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns 204 for OPTIONS preflight", async () => {
    const res = await handleProxyRequest(
      { method: "OPTIONS", url: "/", origin: "https://app.example.com" },
      testConfig,
    )
    expect(res.status).toBe(204)
    expect(res.headers["access-control-allow-origin"]).toBe("https://app.example.com")
    expect(res.headers["access-control-allow-methods"]).toBe("GET, HEAD, OPTIONS")
  })

  it("returns 405 for POST with default config", async () => {
    const res = await handleProxyRequest(
      { method: "POST", url: "/?url=https://example.com", origin: "https://app.example.com" },
      testConfig,
    )
    expect(res.status).toBe(405)
  })

  it("returns 400 for missing ?url=", async () => {
    const res = await handleProxyRequest(
      { method: "GET", url: "/", origin: "https://app.example.com" },
      testConfig,
    )
    expect(res.status).toBe(400)
    expect(JSON.parse(res.body as string).error).toBe("Missing ?url= parameter")
  })

  it("returns 403 for disallowed domain", async () => {
    const res = await handleProxyRequest(
      { method: "GET", url: "/?url=https://evil.com/data", origin: "https://app.example.com" },
      testConfig,
    )
    expect(res.status).toBe(403)
    expect(JSON.parse(res.body as string).error).toBe("Domain not allowed")
  })

  it("proxies allowed URLs", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("hello world", {
      status: 200,
      headers: { "content-type": "text/html" },
    }))
    vi.stubGlobal("fetch", mockFetch)

    const res = await handleProxyRequest(
      { method: "GET", url: "/?url=https://example.com/page", origin: "https://app.example.com" },
      testConfig,
    )
    expect(res.status).toBe(200)
    expect(res.body).toBe("hello world")
    expect(res.headers["access-control-allow-origin"]).toBe("https://app.example.com")
    expect(res.headers["x-cors-prxy"]).toBe("test-proxy")
    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/page",
      expect.objectContaining({ method: "GET" }),
    )
  })

  it("returns empty body for HEAD requests", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("body content", {
      status: 200,
      headers: { "content-type": "text/plain" },
    })))

    const res = await handleProxyRequest(
      { method: "HEAD", url: "/?url=https://example.com/page", origin: "https://app.example.com" },
      testConfig,
    )
    expect(res.status).toBe(200)
    expect(res.body).toBe("")
  })

  it("rejects non-matching CORS origin", async () => {
    const res = await handleProxyRequest(
      { method: "OPTIONS", url: "/", origin: "https://malicious.com" },
      testConfig,
    )
    expect(res.status).toBe(204)
    expect(res.headers["access-control-allow-origin"]).toBeUndefined()
  })

  it("returns 502 on upstream fetch failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Connection refused")))

    const res = await handleProxyRequest(
      { method: "GET", url: "/?url=https://example.com/down", origin: "https://app.example.com" },
      testConfig,
    )
    expect(res.status).toBe(502)
    expect(JSON.parse(res.body as string).error).toBe("Connection refused")
  })
})

describe("full proxy mode", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("allows POST with methods: ['*']", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"ok":true}', {
      status: 200,
      headers: { "content-type": "application/json" },
    })))

    const res = await handleProxyRequest(
      {
        method: "POST",
        url: "/example.com/api/data",
        origin: "https://app.example.com",
        body: '{"key":"value"}',
        headers: { "content-type": "application/json" },
      },
      fullProxyConfig,
    )
    expect(res.status).toBe(200)
    expect(res.body).toBe('{"ok":true}')
  })

  it("forwards body for POST requests", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok", {
      status: 200,
      headers: { "content-type": "text/plain" },
    }))
    vi.stubGlobal("fetch", mockFetch)

    await handleProxyRequest(
      {
        method: "POST",
        url: "/example.com/api",
        origin: "https://app.example.com",
        body: '{"data":1}',
        headers: { "content-type": "application/json", "authorization": "Bearer tok" },
      },
      fullProxyConfig,
    )

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/api",
      expect.objectContaining({
        method: "POST",
        body: '{"data":1}',
      }),
    )
  })

  it("forwards configured headers", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok", {
      status: 200,
      headers: { "content-type": "text/plain" },
    }))
    vi.stubGlobal("fetch", mockFetch)

    await handleProxyRequest(
      {
        method: "POST",
        url: "/example.com/api",
        origin: "https://app.example.com",
        body: "test",
        headers: {
          "content-type": "application/json",
          "authorization": "Bearer secret",
          "x-custom": "should-not-forward",
        },
      },
      fullProxyConfig,
    )

    const fetchCall = mockFetch.mock.calls[0]
    const fetchHeaders = fetchCall[1].headers as Record<string, string>
    expect(fetchHeaders["content-type"]).toBe("application/json")
    expect(fetchHeaders["authorization"]).toBe("Bearer secret")
    expect(fetchHeaders["x-custom"]).toBeUndefined()
    expect(fetchHeaders["host"]).toBe("example.com")
    expect(fetchHeaders["origin"]).toBeUndefined()
  })

  it("parses path-mode URLs", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok", {
      status: 200,
      headers: { "content-type": "text/plain" },
    }))
    vi.stubGlobal("fetch", mockFetch)

    await handleProxyRequest(
      { method: "GET", url: "/example.com/v1/users?limit=10", origin: "https://app.example.com" },
      fullProxyConfig,
    )

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/v1/users?limit=10",
      expect.anything(),
    )
  })

  it("returns 400 for invalid path-mode URL", async () => {
    const res = await handleProxyRequest(
      { method: "GET", url: "/", origin: "https://app.example.com" },
      fullProxyConfig,
    )
    expect(res.status).toBe(400)
    expect(JSON.parse(res.body as string).error).toBe("Invalid path — expected /<host>/<path>")
  })

  it("skips cache for POST requests", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("response", {
      status: 200,
      headers: { "content-type": "text/plain" },
    }))
    vi.stubGlobal("fetch", mockFetch)

    const res = await handleProxyRequest(
      {
        method: "POST",
        url: "/example.com/api",
        origin: "https://app.example.com",
        body: "data",
      },
      fullProxyConfig,
    )
    expect(res.headers["x-cors-prxy-cache"]).toBe("skip")
  })

  it("advertises allowed methods and headers in CORS preflight", async () => {
    const res = await handleProxyRequest(
      { method: "OPTIONS", url: "/", origin: "https://app.example.com" },
      fullProxyConfig,
    )
    expect(res.status).toBe(204)
    expect(res.headers["access-control-allow-methods"]).toBe(
      "GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS"
    )
    expect(res.headers["access-control-allow-headers"]).toBe("content-type, authorization")
    expect(res.headers["access-control-expose-headers"]).toBe("*")
  })

  it("allows selective methods", async () => {
    const selectiveConfig: CorsProxyConfig = {
      ...testConfig,
      methods: ["GET", "POST"],
    }

    const res = await handleProxyRequest(
      { method: "DELETE", url: "/?url=https://example.com/x", origin: "https://app.example.com" },
      selectiveConfig,
    )
    expect(res.status).toBe(405)

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok", {
      status: 200,
      headers: { "content-type": "text/plain" },
    })))

    const res2 = await handleProxyRequest(
      { method: "POST", url: "/?url=https://example.com/x", origin: "https://app.example.com", body: "data" },
      selectiveConfig,
    )
    expect(res2.status).toBe(200)
  })
})
