import { resolveRuntime } from "./config.js";
export async function deploy(config) {
    const runtime = resolveRuntime(config);
    if (runtime === "cloudflare") {
        const { deployCf } = await import("./deploy-cf.js");
        return deployCf(config);
    }
    const { deployLambda } = await import("./deploy-lambda.js");
    return deployLambda(config);
}
export async function destroy(config) {
    const runtime = resolveRuntime(config);
    if (runtime === "cloudflare") {
        const { destroyCf } = await import("./deploy-cf.js");
        return destroyCf(config);
    }
    const { destroyLambda } = await import("./deploy-lambda.js");
    return destroyLambda(config);
}
//# sourceMappingURL=deploy.js.map