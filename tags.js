import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compactAllowlist } from "./allowlist.js";
function getPackageVersion() {
    try {
        const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "../package.json"), "utf-8"));
        return pkg.version ?? "unknown";
    }
    catch {
        return "unknown";
    }
}
function detectRepo() {
    if (process.env.GITHUB_REPOSITORY) {
        return process.env.GITHUB_REPOSITORY;
    }
    try {
        const remote = execSync("git remote get-url origin", { encoding: "utf-8" }).trim();
        return remote
            .replace(/\.git$/, "")
            .replace(/^git@github\.com:/, "")
            .replace(/^https?:\/\/github\.com\//, "");
    }
    catch {
        return "";
    }
}
export function buildTags(config) {
    const tags = {
        "cors-prxy": "true",
        "cors-prxy:name": config.name,
        "cors-prxy:version": getPackageVersion(),
        "cors-prxy:allow": compactAllowlist(config.allow),
    };
    const repo = detectRepo();
    if (repo)
        tags["cors-prxy:repo"] = repo;
    return { ...tags, ...config.tags };
}
async function listLambdaProxies(regions) {
    const { LambdaClient, ListFunctionsCommand, ListTagsCommand, GetFunctionUrlConfigCommand, } = await import("@aws-sdk/client-lambda");
    const results = [];
    for (const region of regions) {
        const client = new LambdaClient({ region });
        let marker;
        do {
            const resp = await client.send(new ListFunctionsCommand({ Marker: marker, MaxItems: 50 }));
            marker = resp.NextMarker;
            for (const fn of resp.Functions ?? []) {
                if (!fn.FunctionArn || !fn.FunctionName)
                    continue;
                const tagsResp = await client.send(new ListTagsCommand({ Resource: fn.FunctionArn }));
                const tags = tagsResp.Tags ?? {};
                if (tags["cors-prxy"] !== "true")
                    continue;
                let endpoint = "";
                try {
                    const urlResp = await client.send(new GetFunctionUrlConfigCommand({ FunctionName: fn.FunctionName }));
                    endpoint = urlResp.FunctionUrl ?? "";
                }
                catch {
                    // No function URL configured
                }
                results.push({
                    name: tags["cors-prxy:name"] ?? fn.FunctionName,
                    runtime: "lambda",
                    endpoint,
                    allow: tags["cors-prxy:allow"] ?? "",
                    repo: tags["cors-prxy:repo"] ?? "",
                    region,
                    version: tags["cors-prxy:version"] ?? "",
                });
            }
        } while (marker);
    }
    return results;
}
async function listCfProxies() {
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!apiToken || !accountId)
        return [];
    try {
        const { listCfWorkers } = await import("./deploy-cf.js");
        const workers = await listCfWorkers(accountId, apiToken);
        return workers.map(w => ({
            name: w.name,
            runtime: "cloudflare",
            endpoint: w.endpoint,
            allow: "",
            repo: "",
            region: "global",
            version: "",
        }));
    }
    catch {
        return [];
    }
}
export async function listProxies(regions, runtimeFilter) {
    const results = [];
    if (!runtimeFilter || runtimeFilter === "lambda") {
        try {
            results.push(...await listLambdaProxies(regions));
        }
        catch (err) {
            if (runtimeFilter === "lambda")
                throw err;
            // When scanning both runtimes, don't fail if AWS creds are missing/expired
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("expired") || msg.includes("credentials") || msg.includes("Could not load")) {
                console.error(`Skipping Lambda (AWS credentials unavailable)`);
            }
            else {
                throw err;
            }
        }
    }
    if (!runtimeFilter || runtimeFilter === "cloudflare") {
        results.push(...await listCfProxies());
    }
    return results;
}
//# sourceMappingURL=tags.js.map