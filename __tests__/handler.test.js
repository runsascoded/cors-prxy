import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleProxyRequest } from "../handler.js";
const testConfig = {
    name: "test-proxy",
    region: "us-east-1",
    allow: ["example.com", "*.example.com"],
    rateLimit: { perIp: 60, window: "1m" },
    cors: { origins: ["https://app.example.com"], maxAge: 86400 },
    cache: { ttl: 300, maxSize: 100 },
    tags: {},
};
describe("handleProxyRequest", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });
    it("returns 204 for OPTIONS preflight", async () => {
        const res = await handleProxyRequest({ method: "OPTIONS", url: "/", origin: "https://app.example.com" }, testConfig);
        expect(res.status).toBe(204);
        expect(res.headers["access-control-allow-origin"]).toBe("https://app.example.com");
        expect(res.headers["access-control-allow-methods"]).toBe("GET, HEAD, OPTIONS");
    });
    it("returns 405 for POST", async () => {
        const res = await handleProxyRequest({ method: "POST", url: "/?url=https://example.com", origin: "https://app.example.com" }, testConfig);
        expect(res.status).toBe(405);
    });
    it("returns 400 for missing ?url=", async () => {
        const res = await handleProxyRequest({ method: "GET", url: "/", origin: "https://app.example.com" }, testConfig);
        expect(res.status).toBe(400);
        expect(JSON.parse(res.body).error).toBe("Missing ?url= parameter");
    });
    it("returns 403 for disallowed domain", async () => {
        const res = await handleProxyRequest({ method: "GET", url: "/?url=https://evil.com/data", origin: "https://app.example.com" }, testConfig);
        expect(res.status).toBe(403);
        expect(JSON.parse(res.body).error).toBe("Domain not allowed");
    });
    it("proxies allowed URLs", async () => {
        const mockFetch = vi.fn().mockResolvedValue(new Response("hello world", {
            status: 200,
            headers: { "content-type": "text/html" },
        }));
        vi.stubGlobal("fetch", mockFetch);
        const res = await handleProxyRequest({ method: "GET", url: "/?url=https://example.com/page", origin: "https://app.example.com" }, testConfig);
        expect(res.status).toBe(200);
        expect(res.body).toBe("hello world");
        expect(res.headers["access-control-allow-origin"]).toBe("https://app.example.com");
        expect(res.headers["x-cors-prxy"]).toBe("test-proxy");
        expect(mockFetch).toHaveBeenCalledWith("https://example.com/page", expect.objectContaining({ method: "GET" }));
    });
    it("returns empty body for HEAD requests", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("body content", {
            status: 200,
            headers: { "content-type": "text/plain" },
        })));
        const res = await handleProxyRequest({ method: "HEAD", url: "/?url=https://example.com/page", origin: "https://app.example.com" }, testConfig);
        expect(res.status).toBe(200);
        expect(res.body).toBe("");
    });
    it("rejects non-matching CORS origin", async () => {
        const res = await handleProxyRequest({ method: "OPTIONS", url: "/", origin: "https://malicious.com" }, testConfig);
        expect(res.status).toBe(204);
        expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });
    it("returns 502 on upstream fetch failure", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Connection refused")));
        const res = await handleProxyRequest({ method: "GET", url: "/?url=https://example.com/down", origin: "https://app.example.com" }, testConfig);
        expect(res.status).toBe(502);
        expect(JSON.parse(res.body).error).toBe("Connection refused");
    });
});
//# sourceMappingURL=handler.test.js.map