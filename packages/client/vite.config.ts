import tailwindcss from "@tailwindcss/vite";
import { reactRouter } from "@react-router/dev/vite";
import { existsSync } from "node:fs";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vite";

// Same lookup order as packages/server/src/index.ts: cwd first (repo-root
// invocations), then relative to this package (pnpm/turbo dev, cwd =
// packages/client). loadEnvFile never overwrites vars already present in
// process.env, so a shell-exported SERVER_PORT/CLIENT_PORT (the mechanism
// that lets several agents run independent dev stacks side by side) always
// wins over the committed .env.
for (const candidate of ["./.env", "../../.env"]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

const CLIENT_PORT = Number(process.env.CLIENT_PORT ?? 5173);
const SERVER_PORT = Number(process.env.SERVER_PORT ?? process.env.PORT ?? 3001);

export default defineConfig({
  plugins: [
    tailwindcss(),
    reactRouter(),
    Icons({ compiler: "jsx", jsx: "react" }),
  ],
  server: {
    port: CLIENT_PORT,
    // Fail fast instead of silently drifting to the next free port — a
    // parallel agent's dev stack relies on CLIENT_PORT being the actual
    // port (scripts/screenshot.mjs and any tooling read it verbatim).
    strictPort: true,
    proxy: {
      // SSE (sync stream) rides plain HTTP through this proxy fine, no ws needed.
      "/api": { target: `http://localhost:${SERVER_PORT}`, changeOrigin: true },
    },
  },
  // React Router's SPA build starts an internal Vite preview server. On
  // Debian, `localhost` can bind to `::1` while its build-time request resolves
  // to `127.0.0.1`; pin both sides to IPv4 so container builds are reliable.
  preview: {
    host: "127.0.0.1",
  },
});
