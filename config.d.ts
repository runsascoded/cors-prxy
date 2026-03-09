export interface AllowRuleObject {
    domain: string;
    paths: string[];
}
export type AllowRule = string | AllowRuleObject;
export interface RateLimitConfig {
    perIp: number;
    window: string;
}
export interface CorsConfig {
    origins: string[];
    maxAge: number;
}
export interface CacheConfig {
    ttl: number;
    maxSize: number;
}
export type Runtime = "cloudflare" | "lambda";
export interface CloudflareConfig {
    accountId?: string;
    workerName?: string;
    route?: string;
    compatibilityDate?: string;
}
export interface CorsProxyConfig {
    name: string;
    region: string;
    allow: AllowRule[];
    rateLimit: RateLimitConfig;
    cors: CorsConfig;
    cache: CacheConfig;
    tags: Record<string, string>;
    /** Deployment runtime. Default: "cloudflare" (or "lambda" if `region` is set). */
    runtime?: Runtime;
    /** Cloudflare-specific config. */
    cloudflare?: CloudflareConfig;
    /** Allowed HTTP methods. Default: ["GET", "HEAD"]. OPTIONS is always handled. */
    methods?: string[];
    /** Request headers to forward upstream (lowercase). Default: [] */
    forwardHeaders?: string[];
    /** How the target URL is specified. "query" = ?url=, "path" = /<host>/<path> */
    urlMode?: "query" | "path";
}
/** Resolve effective runtime: explicit > inferred from `region` > default "cloudflare" */
export declare function resolveRuntime(config: CorsProxyConfig): Runtime;
export declare function parseWindow(s: string): number;
export declare function loadConfig(path?: string): Promise<CorsProxyConfig>;
