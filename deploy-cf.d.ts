import type { CorsProxyConfig } from "./config.js";
import type { DeployResult } from "./deploy-lambda.js";
export declare function resolveAccountId(apiToken: string, config?: CorsProxyConfig): Promise<string>;
export declare function deployCf(config: CorsProxyConfig): Promise<DeployResult>;
export declare function destroyCf(config: CorsProxyConfig): Promise<void>;
export declare function destroyCfByName(name: string, config?: CorsProxyConfig): Promise<void>;
export interface CfWorkerInfo {
    name: string;
    endpoint: string;
}
export declare function listCfWorkers(accountId: string, apiToken: string): Promise<CfWorkerInfo[]>;
