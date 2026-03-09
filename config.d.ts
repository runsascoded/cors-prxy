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
export interface CorsProxyConfig {
    name: string;
    region: string;
    allow: AllowRule[];
    rateLimit: RateLimitConfig;
    cors: CorsConfig;
    cache: CacheConfig;
    tags: Record<string, string>;
}
export declare function parseWindow(s: string): number;
export declare function loadConfig(path?: string): Promise<CorsProxyConfig>;
