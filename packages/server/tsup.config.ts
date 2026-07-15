import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  // Inlines the workspace package so the built server has no
  // workspace-resolution step at runtime.
  noExternal: ["@shelfie/shared"],
});
