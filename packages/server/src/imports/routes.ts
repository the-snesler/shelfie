import { IMPORT_SOURCES, type ImportSource } from "@shelfie/shared";
import type { Hono } from "hono";
import { z } from "zod";
import { ImportService } from "./service.js";

export function registerImportRoutes(app: Hono, service: ImportService): void {
  app.get("/api/imports", async (c) => c.json(await service.list()));
  app.delete("/api/imports/:source", async (c) => {
    const source = c.req.param("source");
    if (!isSource(source))
      return c.json({ error: "Unknown import source" }, 404);
    if (service.isRunning)
      return c.json({ error: "Wait for the current import to finish" }, 409);
    await service.disconnect(source);
    return c.json({ disconnected: true });
  });
  app.put("/api/imports/:source", async (c) => {
    const source = c.req.param("source");
    if (!isSource(source))
      return c.json({ error: "Unknown import source" }, 404);
    try {
      const data = await c.req.json();
      return c.json(await service.save(source, data));
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof z.ZodError
              ? "Invalid source configuration"
              : error instanceof Error
                ? error.message
                : "Invalid source configuration",
        },
        400,
      );
    }
  });
  app.post("/api/imports/:source/run", async (c) => {
    const source = c.req.param("source");
    if (!isSource(source))
      return c.json({ error: "Unknown import source" }, 404);
    const state = (await service.list()).find((row) => row.source === source);
    if (!state || state.running || service.isRunning)
      return c.json({ error: "An import is already running" }, 409);
    if (!(state.hasApiKey || state.hasAccessToken))
      return c.json({ error: "Save a source connection first" }, 400);
    void service.run(source).catch(() => {});
    return c.json({ accepted: true }, 202);
  });
}

function isSource(value: string): value is ImportSource {
  return (IMPORT_SOURCES as readonly string[]).includes(value);
}
