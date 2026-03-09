import { handleProxyRequest } from "./handler.js";
const config = JSON.parse(process.env.CORS_PRXY_CONFIG);
export async function handler(event) {
    const { method, path, sourceIp } = event.requestContext.http;
    const url = `${path}${event.rawQueryString ? `?${event.rawQueryString}` : ""}`;
    let body = null;
    if (event.body) {
        body = event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body;
    }
    const result = await handleProxyRequest({
        method,
        url,
        origin: event.headers["origin"],
        ip: sourceIp,
        body,
        headers: event.headers,
    }, config);
    return {
        statusCode: result.status,
        headers: result.headers,
        body: typeof result.body === "string" ? result.body : result.body.toString("base64"),
        isBase64Encoded: typeof result.body !== "string",
    };
}
//# sourceMappingURL=lambda.js.map