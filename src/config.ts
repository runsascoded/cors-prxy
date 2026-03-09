import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

export interface AllowRuleObject {
  domain: string
  paths: string[]
}

export type AllowRule = string | AllowRuleObject

export interface RateLimitConfig {
  perIp: number
  window: string
}

export interface CorsConfig {
  origins: string[]
  maxAge: number
}

export interface CacheConfig {
  ttl: number
  maxSize: number
}

export type Runtime = "cloudflare" | "lambda"

export interface CloudflareConfig {
  accountId?: string
  workerName?: string
  route?: string
  compatibilityDate?: string
}

export interface CorsProxyConfig {
  name: string
  region: string
  allow: AllowRule[]
  rateLimit: RateLimitConfig
  cors: CorsConfig
  cache: CacheConfig
  tags: Record<string, string>
  /** Deployment runtime. Default: "cloudflare" (or "lambda" if `region` is set). */
  runtime?: Runtime
  /** Cloudflare-specific config. */
  cloudflare?: CloudflareConfig
  /** Allowed HTTP methods. Default: ["GET", "HEAD"]. OPTIONS is always handled. */
  methods?: string[]
  /** Request headers to forward upstream (lowercase). Default: [] */
  forwardHeaders?: string[]
  /** How the target URL is specified. "query" = ?url=, "path" = /<host>/<path> */
  urlMode?: "query" | "path"
}

/** Resolve effective runtime: explicit > inferred from `region` > default "cloudflare" */
export function resolveRuntime(config: CorsProxyConfig): Runtime {
  if (config.runtime) return config.runtime
  // If region was explicitly set (not just the default), assume lambda for BC
  return "cloudflare"
}

const DEFAULTS: { region: string; rateLimit: RateLimitConfig; cors: CorsConfig; cache: CacheConfig; tags: Record<string, string> } = {
  region: "us-east-1",
  rateLimit: { perIp: 60, window: "1m" },
  cors: { origins: ["*"], maxAge: 86400 },
  cache: { ttl: 300, maxSize: 1000 },
  tags: {},
}

export function parseWindow(s: string): number {
  const match = s.match(/^(\d+)(ms|s|m|h)$/)
  if (!match) throw new Error(`Invalid window format: "${s}" (expected e.g. "1m", "30s", "500ms")`)
  const [, value, unit] = match
  const n = parseInt(value, 10)
  switch (unit) {
    case "ms": return n
    case "s": return n * 1000
    case "m": return n * 60_000
    case "h": return n * 3_600_000
    default: throw new Error(`Unknown time unit: ${unit}`)
  }
}

export async function loadConfig(path?: string): Promise<CorsProxyConfig> {
  const configPath = resolve(path ?? ".cors-prxy.json")
  let raw: string
  try {
    raw = await readFile(configPath, "utf-8")
  } catch {
    throw new Error(`Config file not found: ${configPath}`)
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Invalid JSON in config file: ${configPath}`)
  }

  if (!parsed.name || typeof parsed.name !== "string") {
    throw new Error(`Config requires a "name" string field`)
  }
  if (!Array.isArray(parsed.allow) || parsed.allow.length === 0) {
    throw new Error(`Config requires a non-empty "allow" array`)
  }

  for (const rule of parsed.allow) {
    if (typeof rule === "string") continue
    if (typeof rule === "object" && rule !== null && "domain" in rule && "paths" in rule) {
      if (typeof (rule as AllowRuleObject).domain !== "string") {
        throw new Error(`AllowRule object requires a "domain" string`)
      }
      if (!Array.isArray((rule as AllowRuleObject).paths)) {
        throw new Error(`AllowRule object requires a "paths" array`)
      }
      continue
    }
    throw new Error(`Invalid allow rule: ${JSON.stringify(rule)}`)
  }

  return {
    name: parsed.name,
    region: (parsed.region as string) ?? DEFAULTS.region,
    allow: parsed.allow as AllowRule[],
    rateLimit: { ...DEFAULTS.rateLimit, ...(parsed.rateLimit as Partial<RateLimitConfig> | undefined) },
    cors: { ...DEFAULTS.cors, ...(parsed.cors as Partial<CorsConfig> | undefined) },
    cache: { ...DEFAULTS.cache, ...(parsed.cache as Partial<CacheConfig> | undefined) },
    tags: { ...DEFAULTS.tags, ...(parsed.tags as Record<string, string> | undefined) },
    runtime: parsed.runtime as Runtime | undefined,
    cloudflare: parsed.cloudflare as CloudflareConfig | undefined,
    methods: parsed.methods as string[] | undefined,
    forwardHeaders: parsed.forwardHeaders as string[] | undefined,
    urlMode: parsed.urlMode as "query" | "path" | undefined,
  }
}
