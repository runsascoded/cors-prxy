import { build } from "esbuild"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))

await build({
  entryPoints: [resolve(__dirname, "../src/cloudflare.ts")],
  bundle: true,
  platform: "browser",
  target: "es2022",
  format: "esm",
  outfile: resolve(__dirname, "../dist/cloudflare-bundle/index.mjs"),
  minify: true,
  external: ["node:*"],
  conditions: ["worker", "browser"],
})

console.log("Cloudflare Worker bundle written to dist/cloudflare-bundle/index.mjs")
