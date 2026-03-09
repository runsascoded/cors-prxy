import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
/** Resolve effective runtime: explicit > inferred from `region` > default "cloudflare" */
export function resolveRuntime(config) {
    if (config.runtime)
        return config.runtime;
    // If region was explicitly set (not just the default), assume lambda for BC
    return "cloudflare";
}
const DEFAULTS = {
    region: "us-east-1",
    rateLimit: { perIp: 60, window: "1m" },
    cors: { origins: ["*"], maxAge: 86400 },
    cache: { ttl: 300, maxSize: 1000 },
    tags: {},
};
export function parseWindow(s) {
    const match = s.match(/^(\d+)(ms|s|m|h)$/);
    if (!match)
        throw new Error(`Invalid window format: "${s}" (expected e.g. "1m", "30s", "500ms")`);
    const [, value, unit] = match;
    const n = parseInt(value, 10);
    switch (unit) {
        case "ms": return n;
        case "s": return n * 1000;
        case "m": return n * 60_000;
        case "h": return n * 3_600_000;
        default: throw new Error(`Unknown time unit: ${unit}`);
    }
}
export async function loadConfig(path) {
    const configPath = resolve(path ?? ".cors-prxy.json");
    let raw;
    try {
        raw = await readFile(configPath, "utf-8");
    }
    catch {
        throw new Error(`Config file not found: ${configPath}`);
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new Error(`Invalid JSON in config file: ${configPath}`);
    }
    if (!parsed.name || typeof parsed.name !== "string") {
        throw new Error(`Config requires a "name" string field`);
    }
    if (!Array.isArray(parsed.allow) || parsed.allow.length === 0) {
        throw new Error(`Config requires a non-empty "allow" array`);
    }
    for (const rule of parsed.allow) {
        if (typeof rule === "string")
            continue;
        if (typeof rule === "object" && rule !== null && "domain" in rule && "paths" in rule) {
            if (typeof rule.domain !== "string") {
                throw new Error(`AllowRule object requires a "domain" string`);
            }
            if (!Array.isArray(rule.paths)) {
                throw new Error(`AllowRule object requires a "paths" array`);
            }
            continue;
        }
        throw new Error(`Invalid allow rule: ${JSON.stringify(rule)}`);
    }
    return {
        name: parsed.name,
        region: parsed.region ?? DEFAULTS.region,
        allow: parsed.allow,
        rateLimit: { ...DEFAULTS.rateLimit, ...parsed.rateLimit },
        cors: { ...DEFAULTS.cors, ...parsed.cors },
        cache: { ...DEFAULTS.cache, ...parsed.cache },
        tags: { ...DEFAULTS.tags, ...parsed.tags },
        runtime: parsed.runtime,
        cloudflare: parsed.cloudflare,
        methods: parsed.methods,
        forwardHeaders: parsed.forwardHeaders,
        urlMode: parsed.urlMode,
    };
}
//# sourceMappingURL=config.js.map