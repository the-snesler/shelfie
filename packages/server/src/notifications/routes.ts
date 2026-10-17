import type {
  NotificationSettings,
  NotificationSettingsUpdate,
} from "@shelfie/shared";
import type { Hono } from "hono";
import type { Kysely } from "kysely";
import { db as defaultDb } from "../db/index.js";
import type { Database } from "../db/types.js";
import {
  normalizeAppriseEndpoint,
  normalizeDestinations,
  sendApprise,
} from "./apprise.js";

export async function readNotificationSettings(
  database: Kysely<Database>,
): Promise<NotificationSettings> {
  const [settings, pending, failed, last] = await Promise.all([
    database
      .selectFrom("notification_settings")
      .selectAll()
      .where("id", "=", "owner")
      .executeTakeFirst(),
    database
      .selectFrom("notification_deliveries")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("sent_at", "is", null)
      .where("attempts", "<", 5)
      .executeTakeFirstOrThrow(),
    database
      .selectFrom("notification_deliveries")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("sent_at", "is", null)
      .where("attempts", ">=", 5)
      .executeTakeFirstOrThrow(),
    database
      .selectFrom("notification_deliveries")
      .select((eb) => eb.fn.max<number>("sent_at").as("at"))
      .executeTakeFirstOrThrow(),
  ]);
  return {
    enabled: settings?.enabled === 1,
    endpoint: settings?.endpoint ?? "",
    destinationsConfigured: !!settings?.destinations,
    daysBefore: settings?.days_before ?? 0,
    pending: Number(pending.count),
    failed: Number(failed.count),
    lastSentAt: last.at ?? null,
  };
}

/** Must be mounted after owner authentication. Saving never sends a test message. */
export function registerNotificationRoutes(
  app: Hono,
  database: Kysely<Database> = defaultDb,
  fetcher: typeof fetch = fetch,
): void {
  let testInFlight = false;
  let lastTestAt = 0;
  app.get("/api/settings/notifications", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await readNotificationSettings(database));
  });
  app.put("/api/settings/notifications", async (c) => {
    const body = await c.req
      .json<Partial<NotificationSettingsUpdate>>()
      .catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body))
      return c.json({ error: "invalid JSON body" }, 400);
    const endpoint = normalizeAppriseEndpoint(body.endpoint);
    const destinations =
      body.destinations === undefined
        ? undefined
        : normalizeDestinations(body.destinations);
    if (
      typeof body.enabled !== "boolean" ||
      endpoint === null ||
      destinations === null ||
      !Number.isInteger(body.daysBefore) ||
      body.daysBefore! < 0 ||
      body.daysBefore! > 30
    )
      return c.json(
        {
          error:
            "Provide a valid HTTP(S) Apprise base URL, up to 20 destination URLs, and daysBefore from 0 to 30",
        },
        400,
      );
    const previous = await database
      .selectFrom("notification_settings")
      .selectAll()
      .where("id", "=", "owner")
      .executeTakeFirst();
    const urls = destinations ?? previous?.destinations ?? "";
    if (body.enabled && (!endpoint || !urls))
      return c.json(
        {
          error:
            "Apprise URL and destinations are required before enabling notifications",
        },
        400,
      );
    const values = {
      enabled: body.enabled ? 1 : 0,
      endpoint,
      destinations: urls,
      days_before: body.daysBefore!,
      updated_at: Date.now(),
    };
    await database
      .insertInto("notification_settings")
      .values({ id: "owner", ...values })
      .onConflict((oc) => oc.column("id").doUpdateSet(values))
      .execute();
    return c.json(await readNotificationSettings(database));
  });
  app.post("/api/settings/notifications/test", async (c) => {
    if (testInFlight || Date.now() - lastTestAt < 30_000) {
      c.header("Retry-After", "30");
      return c.json(
        { error: "Wait 30 seconds before sending another test" },
        429,
      );
    }
    testInFlight = true;
    try {
      const settings = await database
        .selectFrom("notification_settings")
        .selectAll()
        .where("id", "=", "owner")
        .executeTakeFirst();
      if (!settings?.endpoint || !settings.destinations)
        return c.json(
          { error: "Save an Apprise URL and destinations first" },
          400,
        );
      lastTestAt = Date.now();
      await sendApprise(
        settings.endpoint,
        settings.destinations,
        "Shelfie test notification",
        "Your Shelfie release notifications are configured.",
        fetcher,
      );
      return c.json({ ok: true });
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : "Apprise test failed",
        },
        502,
      );
    } finally {
      testInFlight = false;
    }
  });
}
