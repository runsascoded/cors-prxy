import { handleProxyRequest } from "./handler.js";
const config = "__CORS_PRXY_CONFIG_PLACEHOLDER__";
export default {
    async fetch(request) {
        const url = new URL(request.url);
        const result = await handleProxyRequest({
            method: request.method,
            url: url.pathname + url.search,
            origin: request.headers.get("origin") ?? undefined,
            ip: request.headers.get("cf-connecting-ip") ?? undefined,
            body: request.body,
            headers: Object.fromEntries(request.headers.entries()),
        }, config);
        return new Response(result.body, {
            status: result.status,
            headers: result.headers,
        });
    },
};
//# sourceMappingURL=cloudflare.js.map