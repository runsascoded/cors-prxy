import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  LambdaClient,
  ListFunctionsCommand,
  ListTagsCommand,
  GetFunctionUrlConfigCommand,
} from "@aws-sdk/client-lambda"
import type { CorsProxyConfig } from "./config.js"
import { compactAllowlist } from "./allowlist.js"

export interface ProxyInfo {
  name: string
  endpoint: string
  allow: string
  repo: string
  region: string
  version: string
}

function getPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "../package.json"), "utf-8"))
    return pkg.version ?? "unknown"
  } catch {
    return "unknown"
  }
}

function detectRepo(): string {
  // GHA context
  if (process.env.GITHUB_REPOSITORY) {
    return process.env.GITHUB_REPOSITORY
  }
  try {
    const remote = execSync("git remote get-url origin", { encoding: "utf-8" }).trim()
    // Convert git@github.com:user/repo.git or https://github.com/user/repo.git -> user/repo
    return remote
      .replace(/\.git$/, "")
      .replace(/^git@github\.com:/, "")
      .replace(/^https?:\/\/github\.com\//, "")
  } catch {
    return ""
  }
}

export function buildTags(config: CorsProxyConfig): Record<string, string> {
  const tags: Record<string, string> = {
    "cors-prxy": "true",
    "cors-prxy:name": config.name,
    "cors-prxy:version": getPackageVersion(),
    "cors-prxy:allow": compactAllowlist(config.allow),
  }
  const repo = detectRepo()
  if (repo) tags["cors-prxy:repo"] = repo
  return { ...tags, ...config.tags }
}

export async function listProxies(regions: string[]): Promise<ProxyInfo[]> {
  const results: ProxyInfo[] = []

  for (const region of regions) {
    const client = new LambdaClient({ region })
    let marker: string | undefined

    do {
      const resp = await client.send(new ListFunctionsCommand({ Marker: marker, MaxItems: 50 }))
      marker = resp.NextMarker

      for (const fn of resp.Functions ?? []) {
        if (!fn.FunctionArn || !fn.FunctionName) continue

        const tagsResp = await client.send(new ListTagsCommand({ Resource: fn.FunctionArn }))
        const tags = tagsResp.Tags ?? {}

        if (tags["cors-prxy"] !== "true") continue

        let endpoint = ""
        try {
          const urlResp = await client.send(
            new GetFunctionUrlConfigCommand({ FunctionName: fn.FunctionName })
          )
          endpoint = urlResp.FunctionUrl ?? ""
        } catch {
          // No function URL configured
        }

        results.push({
          name: tags["cors-prxy:name"] ?? fn.FunctionName,
          endpoint,
          allow: tags["cors-prxy:allow"] ?? "",
          repo: tags["cors-prxy:repo"] ?? "",
          region,
          version: tags["cors-prxy:version"] ?? "",
        })
      }
    } while (marker)
  }

  return results
}
