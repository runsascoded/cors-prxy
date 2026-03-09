#!/usr/bin/env node
import { program } from "commander";
import { loadConfig } from "./config.js";
program
    .name("cors-prxy")
    .description("Minimal, security-focused Lambda CORS proxy")
    .version("0.1.0");
program
    .command("deploy")
    .description("Deploy (create or update) the Lambda proxy")
    .option("-c, --config <path>", "Config file path", ".cors-prxy.json")
    .action(async (opts) => {
    const config = await loadConfig(opts.config);
    const { deploy } = await import("./deploy.js");
    const result = await deploy(config);
    if (result.created) {
        console.log(`Created new proxy: ${result.functionName}`);
    }
    else {
        console.log(`Updated proxy: ${result.functionName}`);
    }
});
program
    .command("ls")
    .description("List all cors-prxy Lambdas in current AWS account")
    .option("-r, --regions <regions>", "Comma-separated regions", "us-east-1")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
    const { listProxies } = await import("./tags.js");
    const regions = opts.regions.split(",").map((r) => r.trim());
    const proxies = await listProxies(regions);
    if (opts.json) {
        console.log(JSON.stringify(proxies, null, 2));
        return;
    }
    if (proxies.length === 0) {
        console.log("No cors-prxy Lambdas found.");
        return;
    }
    // Table output
    const header = ["NAME", "ENDPOINT", "ALLOW", "REPO"];
    const rows = proxies.map(p => [p.name, p.endpoint, p.allow, p.repo]);
    const widths = header.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
    const fmt = (row) => row.map((c, i) => c.padEnd(widths[i])).join("  ");
    console.log(fmt(header));
    for (const row of rows)
        console.log(fmt(row));
});
program
    .command("status")
    .description("Show deployed Lambda info for current project")
    .option("-c, --config <path>", "Config file path", ".cors-prxy.json")
    .action(async (opts) => {
    const config = await loadConfig(opts.config);
    const { listProxies } = await import("./tags.js");
    const proxies = await listProxies([config.region]);
    const proxy = proxies.find(p => p.name === config.name);
    if (!proxy) {
        console.log(`No deployed proxy found for "${config.name}" in ${config.region}`);
        process.exit(1);
    }
    console.log(`Name:     ${proxy.name}`);
    console.log(`Endpoint: ${proxy.endpoint}`);
    console.log(`Allow:    ${proxy.allow}`);
    console.log(`Region:   ${proxy.region}`);
    console.log(`Version:  ${proxy.version}`);
    if (proxy.repo)
        console.log(`Repo:     ${proxy.repo}`);
});
program
    .command("logs")
    .description("Tail Lambda logs")
    .option("-c, --config <path>", "Config file path", ".cors-prxy.json")
    .option("-f, --follow", "Follow log output")
    .option("-n, --lines <n>", "Number of log lines", "50")
    .action(async (opts) => {
    const config = await loadConfig(opts.config);
    const { CloudWatchLogsClient, FilterLogEventsCommand, } = await import("@aws-sdk/client-cloudwatch-logs");
    const cwl = new CloudWatchLogsClient({ region: config.region });
    const logGroupName = `/aws/lambda/${config.name}`;
    const limit = parseInt(opts.lines, 10);
    const printEvents = async (startTime) => {
        try {
            const resp = await cwl.send(new FilterLogEventsCommand({
                logGroupName,
                limit,
                startTime,
                interleaved: true,
            }));
            for (const event of resp.events ?? []) {
                const ts = event.timestamp ? new Date(event.timestamp).toISOString() : "";
                process.stdout.write(`${ts} ${event.message}`);
            }
            return resp.events?.at(-1)?.timestamp;
        }
        catch (err) {
            if (err.name === "ResourceNotFoundException") {
                console.log(`No logs found for ${logGroupName}`);
                return undefined;
            }
            throw err;
        }
    };
    let lastTimestamp = await printEvents();
    if (opts.follow) {
        const poll = async () => {
            const ts = await printEvents(lastTimestamp ? lastTimestamp + 1 : undefined);
            if (ts)
                lastTimestamp = ts;
        };
        setInterval(poll, 2000);
    }
});
program
    .command("destroy")
    .description("Remove Lambda + IAM role")
    .option("-c, --config <path>", "Config file path", ".cors-prxy.json")
    .option("-y, --yes", "Skip confirmation")
    .action(async (opts) => {
    const config = await loadConfig(opts.config);
    if (!opts.yes) {
        const readline = await import("node:readline");
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise(resolve => {
            rl.question(`Destroy proxy "${config.name}" in ${config.region}? [y/N] `, resolve);
        });
        rl.close();
        if (answer.toLowerCase() !== "y") {
            console.log("Aborted.");
            return;
        }
    }
    const { destroy } = await import("./deploy.js");
    await destroy(config);
    console.log("Done.");
});
program
    .command("dev")
    .description("Start local dev proxy server")
    .option("-c, --config <path>", "Config file path", ".cors-prxy.json")
    .option("-p, --port <port>", "Port number", "3849")
    .action(async (opts) => {
    const config = await loadConfig(opts.config);
    const { startDevServer } = await import("./dev-server.js");
    startDevServer(config, parseInt(opts.port, 10));
});
program.parse();
//# sourceMappingURL=cli.js.map