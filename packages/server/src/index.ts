import { serve } from "@hono/node-server";
import { existsSync } from "node:fs";
import { createApp } from "./app.js";
import { initDb } from "./db/index.js";

// Deviation from aside: aside assumes envs are pre-exported by the shell or
// Docker tooling. Shelfie's IGDB credentials live in the repo root .env for
// local dev convenience, so load it (if present) before anything reads
// process.env — tried relative to cwd first (Docker's WORKDIR /app), then
// relative to this package (pnpm/turbo dev, cwd = packages/server).
for (const candidate of ["./.env", "../../.env"]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

const PORT = Number(process.env.SERVER_PORT ?? process.env.PORT ?? 3001);

await initDb();

const app = createApp();

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`shelfie server listening on :${info.port}`);
});
