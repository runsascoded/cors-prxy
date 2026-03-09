import type { CorsProxyConfig, Runtime } from "./config.js";
export interface ProxyInfo {
    name: string;
    runtime: Runtime;
    endpoint: string;
    allow: string;
    repo: string;
    region: string;
    version: string;
}
export declare function buildTags(config: CorsProxyConfig): Record<string, string>;
export declare function listProxies(regions: string[], runtimeFilter?: Runtime): Promise<ProxyInfo[]>;
