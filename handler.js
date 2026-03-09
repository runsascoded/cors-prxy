import { isAllowed } from "./allowlist.js";
import { LRUCache } from "./cache.js";
import { parseWindow } from "./config.js";
import picomatch from "picomatch";
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const FETCH_TIMEOUT_MS = 10_000;
let cache = null;
const rateLimitMap = new Map();
function getCache(config) {
    if (!cache) {
        cache = new LRUCache(config.cache.maxSize, config.cache.ttl);
    }
    return cache;
}
function matchOrigin(requestOrigin, patterns) {
    for (const pattern of patterns) {
        if (pattern === "*")
            return true;
        if (picomatch.isMatch(requestOrigin, pattern))
            return true;
    }
    return false;
}
function corsHeaders(config, requestOrigin) {
    const allowedOrigin = requestOrigin && matchOrigin(requestOrigin, config.cors.origins)
        ? requestOrigin
        : config.cors.origins.includes("*") ? "*" : "";
    if (!allowedOrigin)
        return {};
    return {
        "access-control-allow-origin": allowedOrigin,
        "access-control-allow-methods": "GET, HEAD, OPTIONS",
        "access-control-max-age": String(config.cors.maxAge),
        "x-cors-prxy": config.name,
    };
}
function checkRateLimit(ip, config) {
    const now = Date.now();
    const windowMs = parseWindow(config.rateLimit.window);
    const entry = rateLimitMap.get(ip);
    if (!entry || now > entry.resetTime) {
        rateLimitMap.set(ip, { count: 1, resetTime: now + windowMs });
        return true;
    }
    entry.count++;
    return entry.count <= config.rateLimit.perIp;
}
export async function handleProxyRequest(req, config) {
    const cors = corsHeaders(config, req.origin);
    // OPTIONS preflight
    if (req.method === "OPTIONS") {
        return { status: 204, headers: cors, body: "" };
    }
    // Only GET and HEAD
    if (req.method !== "GET" && req.method !== "HEAD") {
        return {
            status: 405,
            headers: { ...cors, "content-type": "application/json" },
            body: JSON.stringify({ error: "Method not allowed. Only GET, HEAD, OPTIONS are supported." }),
        };
    }
    // Parse target URL from ?url= parameter
    let targetUrl;
    try {
        const reqUrl = new URL(req.url, "http://localhost");
        targetUrl = reqUrl.searchParams.get("url") ?? "";
    }
    catch {
        targetUrl = "";
    }
    if (!targetUrl) {
        return {
            status: 400,
            headers: { ...cors, "content-type": "application/json" },
            body: JSON.stringify({ error: "Missing ?url= parameter" }),
        };
    }
    // Allowlist check
    if (!isAllowed(targetUrl, config.allow)) {
        return {
            status: 403,
            headers: { ...cors, "content-type": "application/json" },
            body: JSON.stringify({
                error: "Domain not allowed",
                allowed: config.allow.map(r => typeof r === "string" ? r : r.domain),
            }),
        };
    }
    // Rate limit
    if (req.ip && !checkRateLimit(req.ip, config)) {
        return {
            status: 429,
            headers: { ...cors, "content-type": "application/json", "retry-after": "60" },
            body: JSON.stringify({ error: "Rate limit exceeded" }),
        };
    }
    // Check cache
    const responseCache = getCache(config);
    const cached = responseCache.get(targetUrl);
    if (cached) {
        return {
            status: cached.status,
            headers: {
                ...cached.headers,
                ...cors,
                "x-cors-prxy-cache": "hit",
                "cache-control": `public, max-age=${config.cache.ttl}`,
            },
            body: req.method === "HEAD" ? "" : cached.body,
        };
    }
    // Fetch upstream
    let response;
    try {
        response = await fetch(targetUrl, {
            method: "GET",
            redirect: "follow",
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : "Upstream fetch failed";
        return {
            status: 502,
            headers: { ...cors, "content-type": "application/json" },
            body: JSON.stringify({ error: message }),
        };
    }
    // Size check
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
        return {
            status: 413,
            headers: { ...cors, "content-type": "application/json" },
            body: JSON.stringify({ error: "Response too large (>5MB)" }),
        };
    }
    const body = await response.text();
    if (body.length > MAX_RESPONSE_SIZE) {
        return {
            status: 413,
            headers: { ...cors, "content-type": "application/json" },
            body: JSON.stringify({ error: "Response too large (>5MB)" }),
        };
    }
    // Build response headers, forwarding content-type from upstream
    const upstreamContentType = response.headers.get("content-type") ?? "application/octet-stream";
    const responseHeaders = {
        ...cors,
        "content-type": upstreamContentType,
        "cache-control": `public, max-age=${config.cache.ttl}`,
        "x-cors-prxy-cache": "miss",
    };
    // Cache the response
    responseCache.set(targetUrl, {
        status: response.status,
        headers: { "content-type": upstreamContentType },
        body,
    });
    return {
        status: response.status,
        headers: responseHeaders,
        body: req.method === "HEAD" ? "" : body,
    };
}
//# sourceMappingURL=handler.js.map