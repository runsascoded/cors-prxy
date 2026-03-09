import type { CorsProxyConfig, Runtime } from "./config.js";
import type { DeployResult } from "./deploy-lambda.js";
export type { DeployResult };
export declare function deploy(config: CorsProxyConfig): Promise<DeployResult>;
export interface DestroyTarget {
    runtime: Runtime;
    name: string;
    detail: string;
}
/** Discover what resources exist for a given name across runtimes. */
export declare function findDestroyTargets(name: string, region: string, runtimeFilter?: Runtime): Promise<DestroyTarget[]>;
/** Destroy resources for a single runtime. */
export declare function destroyByRuntime(runtime: Runtime, name: string, config?: CorsProxyConfig): Promise<void>;
/** Destroy all runtimes for a config (cross-runtime). */
export declare function destroy(config: CorsProxyConfig, runtimeFilter?: Runtime): Promise<void>;
