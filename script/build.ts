const result = await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  target: "bun",
  format: "esm",
  packages: "external",
})
if (!result.success) throw new AggregateError(result.logs, "Plugin build failed")
