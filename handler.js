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
    const methods = config.methods ?? ["GET", "HEAD"];
    const methodStr = methods[0] === "*"
        ? "GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS"
        : [...methods, "OPTIONS"].join(", ");
    const hdrs = {
        "access-control-allow-origin": allowedOrigin,
        "access-control-allow-methods": methodStr,
        "access-control-max-age": String(config.cors.maxAge),
        "x-cors-prxy": config.name,
    };
    if (config.forwardHeaders?.length) {
        hdrs["access-control-allow-headers"] = config.forwardHeaders.join(", ");
        hdrs["access-control-expose-headers"] = "*";
    }
    return hdrs;
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
function isMethodAllowed(method, config) {
    const methods = config.methods ?? ["GET", "HEAD"];
    return methods[0] === "*" || methods.includes(method);
}
function isCacheable(method) {
    return method === "GET" || method === "HEAD";
}
function parseTargetUrl(reqUrl, config) {
    const urlMode = config.urlMode ?? "query";
    if (urlMode === "query") {
        try {
            const parsed = new URL(reqUrl, "http://localhost");
            return parsed.searchParams.get("url") ?? "";
        }
        catch {
            return "";
        }
    }
    // Path mode: /<host>/<path>?search
    try {
        const parsed = new URL(reqUrl, "http://localhost");
        const match = parsed.pathname.match(/^\/([^/]+)(\/.*)?$/);
        if (!match)
            return "";
        const host = match[1];
        const path = match[2] || "/";
        return `https://${host}${path}${parsed.search}`;
    }
    catch {
        return "";
    }
}
export async function handleProxyRequest(req, config) {
    const cors = corsHeaders(config, req.origin);
    // OPTIONS preflight
    if (req.method === "OPTIONS") {
        return { status: 204, headers: cors, body: "" };
    }
    // Method check
    if (!isMethodAllowed(req.method, config)) {
        const methods = config.methods ?? ["GET", "HEAD"];
        const allowed = methods[0] === "*" ? "any method" : [...methods, "OPTIONS"].join(", ");
        return {
            status: 405,
            headers: { ...cors, "content-type": "application/json" },
            body: JSON.stringify({ error: `Method not allowed. Supported: ${allowed}` }),
        };
    }
    // Parse target URL
    const targetUrl = parseTargetUrl(req.url, config);
    if (!targetUrl) {
        const hint = (config.urlMode ?? "query") === "query"
            ? "Missing ?url= parameter"
            : "Invalid path — expected /<host>/<path>";
        return {
            status: 400,
            headers: { ...cors, "content-type": "application/json" },
            body: JSON.stringify({ error: hint }),
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
    // Check cache (only for GET/HEAD)
    const responseCache = getCache(config);
    if (isCacheable(req.method)) {
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
    }
    // Build upstream fetch options
    const fetchInit = {
        method: req.method,
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    };
    // Forward body for non-GET/HEAD
    if (!isCacheable(req.method) && req.body) {
        fetchInit.body = req.body;
    }
    // Forward configured headers
    if (config.forwardHeaders?.length && req.headers) {
        const headers = {};
        for (const name of config.forwardHeaders) {
            const value = req.headers[name];
            if (value)
                headers[name] = value;
        }
        // Always set Host to target, strip Origin
        const targetHost = new URL(targetUrl).host;
        headers["host"] = targetHost;
        delete headers["origin"];
        fetchInit.headers = headers;
    }
    // Fetch upstream
    let response;
    try {
        response = await fetch(targetUrl, fetchInit);
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
    // Build response headers
    const upstreamContentType = response.headers.get("content-type") ?? "application/octet-stream";
    const responseHeaders = {
        ...cors,
        "content-type": upstreamContentType,
        "x-cors-prxy-cache": isCacheable(req.method) ? "miss" : "skip",
    };
    if (isCacheable(req.method)) {
        responseHeaders["cache-control"] = `public, max-age=${config.cache.ttl}`;
    }
    // Cache GET/HEAD responses only
    if (isCacheable(req.method)) {
        responseCache.set(targetUrl, {
            status: response.status,
            headers: { "content-type": upstreamContentType },
            body,
        });
    }
    return {
        status: response.status,
        headers: responseHeaders,
        body: req.method === "HEAD" ? "" : body,
    };
}
//# sourceMappingURL=handler.js.map