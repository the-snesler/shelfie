import type { Hono } from "hono";
import type { Kysely } from "kysely";
import { createHash, randomBytes } from "node:crypto";
import { db as defaultDb } from "../db/index.js";
import type { Database } from "../db/types.js";
import { readCalendarEntries } from "./events.js";
import { renderCalendar } from "./ical.js";

const OWNER = "owner";
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/** Mount before the session gate: the random subscription token is the credential. */
export function registerCalendarFeedRoutes(
  app: Hono,
  database: Kysely<Database> = defaultDb,
): void {
  app.get("/api/calendar/feed/:token/library.ics", async (c) => {
    c.header("Cache-Control", "private, no-store");
    c.header("Referrer-Policy", "no-referrer");
    const token = c.req.param("token");
    if (!/^[a-f0-9]{64}$/.test(token)) return c.notFound();
    const subscription = await database
      .selectFrom("calendar_subscription")
      .select("id")
      .where("id", "=", OWNER)
      .where("token_hash", "=", hash(token))
      .executeTakeFirst();
    if (!subscription) return c.notFound();
    c.header("Content-Type", "text/calendar; charset=utf-8");
    c.header("Content-Disposition", 'inline; filename="shelfie.ics"');
    return c.body(renderCalendar(await readCalendarEntries(database)));
  });
}

/** All management routes must be mounted after the session gate. */
export function registerCalendarSettingsRoutes(
  app: Hono,
  database: Kysely<Database> = defaultDb,
): void {
  app.get("/api/settings/calendar", async (c) => {
    const row = await database
      .selectFrom("calendar_subscription")
      .select("created_at")
      .where("id", "=", OWNER)
      .executeTakeFirst();
    return c.json({ enabled: !!row, createdAt: row?.created_at ?? null });
  });
  app.post("/api/settings/calendar", async (c) => {
    const token = randomBytes(32).toString("hex");
    const createdAt = Date.now();
    await database
      .insertInto("calendar_subscription")
      .values({ id: OWNER, token_hash: hash(token), created_at: createdAt })
      .onConflict((oc) =>
        oc
          .column("id")
          .doUpdateSet({ token_hash: hash(token), created_at: createdAt }),
      )
      .execute();
    c.header("Cache-Control", "no-store");
    return c.json({
      enabled: true,
      createdAt,
      path: `/api/calendar/feed/${token}/library.ics`,
    });
  });
  app.delete("/api/settings/calendar", async (c) => {
    await database
      .deleteFrom("calendar_subscription")
      .where("id", "=", OWNER)
      .execute();
    return c.json({ enabled: false, createdAt: null });
  });
}
