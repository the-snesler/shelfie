import {
  BOOK_LINK_SOURCES,
  IMPORT_SOURCES,
  type BookLinkSource,
  type ImportSource,
} from "@shelfie/shared";
import type { Hono } from "hono";
import { z } from "zod";
import { ImportService } from "./service.js";

const linkInput = z
  .object({ goodreadsId: z.number().int().positive().safe().nullable() })
  .strict();

export function registerImportRoutes(app: Hono, service: ImportService): void {
  app.get("/api/imports", async (c) => c.json(await service.list()));
  app.get("/api/imports/:source/links", async (c) => {
    const source = c.req.param("source");
    if (!isLinkSource(source))
      return c.json({ error: "This source has no book matches" }, 404);
    return c.json(await service.listBookLinks(source));
  });
  app.put("/api/imports/:source/links/:externalId", async (c) => {
    const source = c.req.param("source");
    if (!isLinkSource(source))
      return c.json({ error: "This source has no book matches" }, 404);
    const parsed = linkInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: "Enter a Goodreads book ID or null" }, 400);
    const link = await service.setBookLink(
      source,
      c.req.param("externalId"),
      parsed.data.goodreadsId,
    );
    return link
      ? c.json(link)
      : c.json({ error: "Unknown source book; run an import first" }, 404);
  });
  app.delete("/api/imports/:source/links/:externalId", async (c) => {
    const source = c.req.param("source");
    if (!isLinkSource(source))
      return c.json({ error: "This source has no book matches" }, 404);
    if (!(await service.resetBookLink(source, c.req.param("externalId"))))
      return c.json({ error: "Unknown source book" }, 404);
    return c.json({ reset: true });
  });
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

function isLinkSource(value: string): value is BookLinkSource {
  return (BOOK_LINK_SOURCES as readonly string[]).includes(value);
}

function isSource(value: string): value is ImportSource {
  return (IMPORT_SOURCES as readonly string[]).includes(value);
}
