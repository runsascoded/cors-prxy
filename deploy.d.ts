import type { CorsProxyConfig } from "./config.js";
export interface DeployResult {
    functionName: string;
    endpoint: string;
    created: boolean;
}
export declare function deploy(config: CorsProxyConfig): Promise<DeployResult>;
export declare function destroy(config: CorsProxyConfig): Promise<void>;
