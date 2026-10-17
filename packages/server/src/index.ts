import { serve } from "@hono/node-server";
import { existsSync } from "node:fs";
import { createApp } from "./app.js";
import { db, initDb } from "./db/index.js";
import { startNotificationWorker } from "./notifications/worker.js";
import { ImportService } from "./imports/service.js";
import { startImportWorker } from "./imports/worker.js";

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

const imports = new ImportService(db);
const stopImports = await startImportWorker(imports);
const stopNotifications = startNotificationWorker();
const app = createApp(imports);

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`shelfie server listening on :${info.port}`);
});

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const workersStopped = Promise.allSettled([
      stopImports(),
      stopNotifications(),
    ]);
    // SSE connections otherwise keep server.close() waiting indefinitely.
    // Interrupted imports retain their running marker and recover on restart.
    const deadline = setTimeout(() => {
      if ("closeAllConnections" in server) server.closeAllConnections();
      process.exit(0);
    }, 5000);
    deadline.unref();
    server.close(() => {
      void workersStopped
        .then(() => db.destroy())
        .finally(() => {
          clearTimeout(deadline);
          process.exit(0);
        });
    });
  });
}
