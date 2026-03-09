import type { CorsProxyConfig } from "./config.js";
export interface ProxyInfo {
    name: string;
    endpoint: string;
    allow: string;
    repo: string;
    region: string;
    version: string;
}
export declare function buildTags(config: CorsProxyConfig): Record<string, string>;
export declare function listProxies(regions: string[]): Promise<ProxyInfo[]>;
