import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { CorsProxyConfig } from "./config.js"
import type { DeployResult } from "./deploy-lambda.js"

function getCfAuth(): { apiToken: string } {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN
  if (!apiToken) {
    throw new Error(
      "CLOUDFLARE_API_TOKEN env var is required for Cloudflare deploys.\n" +
      "Create one at https://dash.cloudflare.com/profile/api-tokens"
    )
  }
  return { apiToken }
}

function getCfAccountId(config: CorsProxyConfig): string {
  const accountId = config.cloudflare?.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID
  if (!accountId) {
    throw new Error(
      "Cloudflare account ID is required. Set it in config (cloudflare.accountId) " +
      "or via CLOUDFLARE_ACCOUNT_ID env var."
    )
  }
  return accountId
}

function getWorkerName(config: CorsProxyConfig): string {
  return config.cloudflare?.workerName ?? `cors-prxy-${config.name}`
}

async function cfApi(
  path: string,
  apiToken: string,
  opts: RequestInit = {},
): Promise<{ success: boolean; result?: Record<string, unknown>; errors?: Array<{ message: string }> }> {
  const resp = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...opts,
    headers: {
      "Authorization": `Bearer ${apiToken}`,
      ...opts.headers as Record<string, string>,
    },
  })
  return resp.json() as Promise<{ success: boolean; result?: Record<string, unknown>; errors?: Array<{ message: string }> }>
}

function loadCfBundle(): string {
  const bundlePath = resolve(import.meta.dirname, "cloudflare-bundle/index.mjs")
  return readFileSync(bundlePath, "utf-8")
}

export async function deployCf(config: CorsProxyConfig): Promise<DeployResult> {
  const { apiToken } = getCfAuth()
  const accountId = getCfAccountId(config)
  const workerName = getWorkerName(config)

  // Load pre-built worker bundle
  let bundleCode = loadCfBundle()

  // Inject config into the bundle
  const configJson = JSON.stringify(config)
  bundleCode = bundleCode.replace('"__CORS_PRXY_CONFIG_PLACEHOLDER__"', configJson)

  // Check if worker exists
  const existing = await cfApi(
    `/accounts/${accountId}/workers/scripts/${workerName}`,
    apiToken,
  )
  const created = !existing.success

  // Upload worker as ESM module
  console.log(`${created ? "Creating" : "Updating"} Cloudflare Worker: ${workerName}`)

  const metadata = JSON.stringify({
    main_module: "index.mjs",
    compatibility_date: config.cloudflare?.compatibilityDate ?? "2024-01-01",
    compatibility_flags: ["nodejs_compat"],
  })

  const boundary = `----CorsProxyBoundary${Date.now()}`
  const body = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="metadata"; filename="metadata.json"`,
    `Content-Type: application/json`,
    ``,
    metadata,
    `--${boundary}`,
    `Content-Disposition: form-data; name="index.mjs"; filename="index.mjs"`,
    `Content-Type: application/javascript+module`,
    ``,
    bundleCode,
    `--${boundary}--`,
  ].join("\r\n")

  const uploadResp = await cfApi(
    `/accounts/${accountId}/workers/scripts/${workerName}`,
    apiToken,
    {
      method: "PUT",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    },
  )

  if (!uploadResp.success) {
    const msgs = uploadResp.errors?.map(e => e.message).join(", ") ?? "Unknown error"
    throw new Error(`Failed to deploy worker: ${msgs}`)
  }

  // Enable workers.dev subdomain
  await cfApi(
    `/accounts/${accountId}/workers/scripts/${workerName}/subdomain`,
    apiToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    },
  )

  // Get the subdomain
  const subdomainResp = await cfApi(
    `/accounts/${accountId}/workers/subdomain`,
    apiToken,
  )
  const subdomain = (subdomainResp.result as { subdomain?: string } | undefined)?.subdomain ?? accountId

  const endpoint = `https://${workerName}.${subdomain}.workers.dev`

  // Set up route if configured
  if (config.cloudflare?.route) {
    console.log(`Setting up route: ${config.cloudflare.route}`)
    await cfApi(
      `/accounts/${accountId}/workers/scripts/${workerName}/routes`,
      apiToken,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern: config.cloudflare.route }),
      },
    )
  }

  console.log(`\nEndpoint: ${endpoint}`)
  return { functionName: workerName, endpoint, created }
}

export async function destroyCf(config: CorsProxyConfig): Promise<void> {
  const { apiToken } = getCfAuth()
  const accountId = getCfAccountId(config)
  const workerName = getWorkerName(config)

  console.log(`Deleting Cloudflare Worker: ${workerName}`)
  const resp = await cfApi(
    `/accounts/${accountId}/workers/scripts/${workerName}`,
    apiToken,
    { method: "DELETE" },
  )

  if (!resp.success) {
    const msgs = resp.errors?.map(e => e.message).join(", ") ?? "Unknown error"
    if (msgs.includes("not found")) {
      console.log("Worker not found (already deleted?)")
      return
    }
    throw new Error(`Failed to delete worker: ${msgs}`)
  }

  console.log(`Deleted worker: ${workerName}`)
}

export interface CfWorkerInfo {
  name: string
  endpoint: string
}

export async function listCfWorkers(accountId: string, apiToken: string): Promise<CfWorkerInfo[]> {
  const resp = await cfApi(
    `/accounts/${accountId}/workers/scripts`,
    apiToken,
  )

  if (!resp.success) return []

  const scripts = resp.result as unknown as Array<{ id: string }>
  const corsProxyWorkers = scripts.filter(s => s.id.startsWith("cors-prxy-"))

  // Get subdomain for endpoint URLs
  const subdomainResp = await cfApi(
    `/accounts/${accountId}/workers/subdomain`,
    apiToken,
  )
  const subdomain = (subdomainResp.result as { subdomain?: string } | undefined)?.subdomain ?? accountId

  return corsProxyWorkers.map(w => ({
    name: w.id.replace(/^cors-prxy-/, ""),
    endpoint: `https://${w.id}.${subdomain}.workers.dev`,
  }))
}
