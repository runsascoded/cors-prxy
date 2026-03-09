import { resolveRuntime } from "./config.js"
import type { CorsProxyConfig } from "./config.js"
import type { DeployResult } from "./deploy-lambda.js"

export type { DeployResult }

export async function deploy(config: CorsProxyConfig): Promise<DeployResult> {
  const runtime = resolveRuntime(config)
  if (runtime === "cloudflare") {
    const { deployCf } = await import("./deploy-cf.js")
    return deployCf(config)
  }
  const { deployLambda } = await import("./deploy-lambda.js")
  return deployLambda(config)
}

export async function destroy(config: CorsProxyConfig): Promise<void> {
  const runtime = resolveRuntime(config)
  if (runtime === "cloudflare") {
    const { destroyCf } = await import("./deploy-cf.js")
    return destroyCf(config)
  }
  const { destroyLambda } = await import("./deploy-lambda.js")
  return destroyLambda(config)
}
