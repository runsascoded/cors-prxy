import { resolveRuntime } from "./config.js"
import type { CorsProxyConfig, Runtime } from "./config.js"
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

export interface DestroyTarget {
  runtime: Runtime
  name: string
  detail: string
}

/** Discover what resources exist for a given name across runtimes. */
export async function findDestroyTargets(
  name: string,
  region: string,
  runtimeFilter?: Runtime,
): Promise<DestroyTarget[]> {
  const targets: DestroyTarget[] = []

  if (!runtimeFilter || runtimeFilter === "lambda") {
    try {
      const { LambdaClient, GetFunctionCommand, GetFunctionUrlConfigCommand } = await import("@aws-sdk/client-lambda")
      const client = new LambdaClient({ region })
      await client.send(new GetFunctionCommand({ FunctionName: name }))
      let urlInfo = ""
      try {
        const urlResp = await client.send(new GetFunctionUrlConfigCommand({ FunctionName: name }))
        urlInfo = urlResp.FunctionUrl ? ` + Function URL` : ""
      } catch {}
      targets.push({
        runtime: "lambda",
        name,
        detail: `Lambda: ${name} (${region})${urlInfo} + IAM role`,
      })
    } catch (err) {
      const errName = (err as { name?: string }).name
      if (errName !== "ResourceNotFoundException") {
        const msg = err instanceof Error ? err.message : String(err)
        if (!msg.includes("expired") && !msg.includes("credentials") && !msg.includes("Could not load")) {
          if (runtimeFilter === "lambda") throw err
        }
      }
    }
  }

  if (!runtimeFilter || runtimeFilter === "cloudflare") {
    const apiToken = process.env.CLOUDFLARE_API_TOKEN
    if (apiToken) {
      try {
        const { resolveAccountId } = await import("./deploy-cf.js")
        const accountId = await resolveAccountId(apiToken)
        const workerName = `cors-prxy-${name}`
        const resp = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}`, {
          headers: { Authorization: `Bearer ${apiToken}` },
        })
        if (resp.ok) {
          targets.push({
            runtime: "cloudflare",
            name,
            detail: `CF Worker: ${workerName}`,
          })
        }
      } catch {}
    }
  }

  return targets
}

/** Destroy resources for a single runtime. */
export async function destroyByRuntime(
  runtime: Runtime,
  name: string,
  config?: CorsProxyConfig,
): Promise<void> {
  if (runtime === "cloudflare") {
    const { destroyCfByName } = await import("./deploy-cf.js")
    await destroyCfByName(name, config)
  } else {
    const { destroyLambdaByName } = await import("./deploy-lambda.js")
    const region = config?.region ?? "us-east-1"
    await destroyLambdaByName(name, region)
  }
}

/** Destroy all runtimes for a config (cross-runtime). */
export async function destroy(config: CorsProxyConfig, runtimeFilter?: Runtime): Promise<void> {
  const targets = await findDestroyTargets(config.name, config.region, runtimeFilter)
  for (const target of targets) {
    await destroyByRuntime(target.runtime, target.name, config)
  }
  if (targets.length === 0) {
    console.log("No resources found to destroy.")
  }
}
