import { build } from "esbuild"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))

await build({
  entryPoints: [resolve(__dirname, "../src/lambda.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: resolve(__dirname, "../dist/lambda-bundle/index.mjs"),
  minify: true,
  external: [],
  banner: {
    // Lambda ESM handler requires this for top-level await / dynamic import compat
    js: "// cors-prxy Lambda bundle",
  },
})

console.log("Lambda bundle written to dist/lambda-bundle/index.mjs")
