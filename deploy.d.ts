import type { CorsProxyConfig } from "./config.js";
import type { DeployResult } from "./deploy-lambda.js";
export type { DeployResult };
export declare function deploy(config: CorsProxyConfig): Promise<DeployResult>;
export declare function destroy(config: CorsProxyConfig): Promise<void>;
