import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { createAuthMiddleware, registerAuthRoutes } from "./auth/index.js";
import { registerBooksRoutes } from "./books/routes.js";
import { registerGamesRoutes } from "./games/routes.js";
import { registerMoviesRoutes } from "./movies/routes.js";
import { registerTvRoutes } from "./tv/routes.js";
import { registerImageRoutes } from "./images/routes.js";
import type { ReplicatedDoc, SyncCollection } from "./sync/collection.js";
import { libraryItemsSync } from "./sync/library-items.js";
import { pull } from "./sync/pull.js";
import { push, type PushRow } from "./sync/push.js";
import { onChange } from "./sync/stream.js";

// Relative to cwd; the Docker runtime sets WORKDIR /app and STATIC_DIR=./public.
const STATIC_DIR = process.env.STATIC_DIR;
const BACKGROUND_SVG_CACHE_CONTROL =
  "public, max-age=31536000, immutable";

/**
 * Builds the Hono app with every route mounted, but starts no background work
 * and binds no port — side-effect-free so tests can drive it via
 * `app.request(...)` in-process. `index.ts` does the actual bootstrap.
 */
export function createApp(): Hono {
  const app = new Hono();

  app.use("/api/*", cors());

  app.get("/health", (c) => c.json({ status: "ok" }));

  registerAuthRoutes(app);
  registerImageRoutes(app);
  app.use("/api/*", createAuthMiddleware());

  registerSyncRoutes(app, libraryItemsSync);

  registerGamesRoutes(app);
  registerMoviesRoutes(app);
  registerTvRoutes(app);
  registerBooksRoutes(app);

  // In prod the single container serves the built client from STATIC_DIR, with
  // an SPA fallback to index.html for any non-API, non-file route. Must be
  // registered last or it would shadow the API routes above.
  if (STATIC_DIR) {
    app.use("/assets/backgrounds/*", async (c, next) => {
      await next();
      if (c.res.headers.get("Content-Type")?.startsWith("image/svg+xml")) {
        c.header("Cache-Control", BACKGROUND_SVG_CACHE_CONTROL);
      }
    });
    app.use("/*", serveStatic({ root: STATIC_DIR }));
    app.get("/*", serveStatic({ path: "index.html", root: STATIC_DIR }));
  }

  return app;
}

/**
 * Mounts the pull/push/stream trio for one collection under
 * `/api/sync/:collection/*`. Every synced collection goes through the same
 * generic handlers — the descriptor carries the table-specific behaviour.
 */
function registerSyncRoutes<TDoc extends ReplicatedDoc>(
  app: Hono,
  coll: SyncCollection<TDoc>,
): void {
  const base = `/api/sync/${coll.name}`;

  // Pull: client sends its checkpoint, gets back changed docs + a new checkpoint.
  app.post(`${base}/pull`, async (c) => {
    const body = await c.req.json<{
      checkpoint?: { seq: number } | null;
      batchSize?: number;
    }>();
    const result = await pull(coll, {
      checkpoint: body.checkpoint ?? null,
      batchSize: body.batchSize ?? 100,
    });
    return c.json(result);
  });

  // Push: client sends changed docs; server returns conflicting master docs.
  app.post(`${base}/push`, async (c) => {
    const rows = await c.req.json<PushRow<TDoc>[]>();
    const conflicts = await push(coll, rows);
    return c.json(conflicts);
  });

  // Stream: SSE feed of this collection's changes, so a second instance updates live.
  app.get(`${base}/stream`, (c) => {
    return streamSSE(c, async (stream) => {
      let closed = false;
      const unsub = onChange(coll.name, (event) => {
        void stream.writeSSE({ data: JSON.stringify(event) }).catch(() => {});
      });
      stream.onAbort(() => {
        closed = true;
        unsub();
      });
      // Keep the connection alive through proxies with a periodic comment ping.
      while (!closed) {
        await stream.writeSSE({ event: "ping", data: String(Date.now()) });
        await stream.sleep(15000);
      }
    });
  });
}
