import {
  LIBRARY_THEMES,
  type LibraryTheme,
  type OwnerSettings,
} from "@shelfie/shared";
import type { Hono } from "hono";
import type { Kysely } from "kysely";
import { db as defaultDb } from "../db/index.js";
import type { Database } from "../db/types.js";

const OWNER_ID = "owner";

export function registerSettingsRoutes(
  app: Hono,
  database: Kysely<Database> = defaultDb,
): void {
  app.get("/api/settings", async (c) => {
    const row = await getOwnerSettings(database);
    if (!row) return c.json({ error: "owner is not configured" }, 404);
    return c.json<OwnerSettings>(row);
  });

  app.patch("/api/settings", async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body) return c.json({ error: "invalid JSON body" }, 400);

    const updates: { library_theme?: string; show_progress_bars?: number } = {};
    if ("libraryTheme" in body) {
      if (!isLibraryTheme(body.libraryTheme)) {
        return c.json({ error: "invalid libraryTheme" }, 400);
      }
      updates.library_theme = body.libraryTheme;
    }
    if ("showProgressBars" in body) {
      if (typeof body.showProgressBars !== "boolean") {
        return c.json({ error: "showProgressBars must be a boolean" }, 400);
      }
      updates.show_progress_bars = body.showProgressBars ? 1 : 0;
    }
    if (Object.keys(updates).length === 0) {
      return c.json({ error: "no settings to update" }, 400);
    }

    await database
      .updateTable("auth_owner")
      .set({ ...updates, updated_at: Date.now() })
      .where("id", "=", OWNER_ID)
      .execute();
    const row = await getOwnerSettings(database);
    if (!row) return c.json({ error: "owner is not configured" }, 404);
    return c.json<OwnerSettings>(row);
  });
}

async function getOwnerSettings(
  database: Kysely<Database>,
): Promise<OwnerSettings | null> {
  const row = await database
    .selectFrom("auth_owner")
    .select(["username", "library_theme", "show_progress_bars"])
    .where("id", "=", OWNER_ID)
    .executeTakeFirst();
  return row
    ? {
        username: row.username,
        libraryTheme: row.library_theme as LibraryTheme,
        showProgressBars: row.show_progress_bars === 1,
      }
    : null;
}

function isLibraryTheme(value: unknown): value is LibraryTheme {
  return (
    typeof value === "string" &&
    (LIBRARY_THEMES as readonly string[]).includes(value)
  );
}
