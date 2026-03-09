import type { CorsProxyConfig } from "./config.js";
export interface DeployResult {
    functionName: string;
    endpoint: string;
    created: boolean;
}
export declare function deployLambda(config: CorsProxyConfig): Promise<DeployResult>;
export declare function destroyLambda(config: CorsProxyConfig): Promise<void>;
export declare function destroyLambdaByName(name: string, region: string): Promise<void>;
