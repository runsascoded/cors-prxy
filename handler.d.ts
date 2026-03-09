import type { CorsProxyConfig } from "./config.js";
export interface ProxyRequest {
    method: string;
    url: string;
    origin?: string;
    ip?: string;
    body?: string | Buffer | ReadableStream | null;
    headers?: Record<string, string>;
}
export interface ProxyResponse {
    status: number;
    headers: Record<string, string>;
    body: string | Buffer;
}
export declare function handleProxyRequest(req: ProxyRequest, config: CorsProxyConfig): Promise<ProxyResponse>;
