// Minimal esbuild config for the VS Code extension bundle.
// Produces dist/extension.js as a CommonJS bundle suitable for Node 20.
const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const opts = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "dist/extension.js",
  external: ["vscode"],
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

async function main() {
  if (watch) {
    const ctx = await esbuild.context(opts);
    await ctx.watch();
    console.log("Polyvoice: watching...");
  } else {
    await esbuild.build(opts);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
