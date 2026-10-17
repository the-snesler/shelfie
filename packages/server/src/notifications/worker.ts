import type { Kysely } from "kysely";
import { createHash } from "node:crypto";
import {
  readCalendarEntries,
  shiftDay,
  type CalendarEntry,
} from "../calendar/events.js";
import { db as defaultDb } from "../db/index.js";
import type { Database } from "../db/types.js";
import { sendApprise } from "./apprise.js";

const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_CYCLE = 5;
const deliveryId = (entry: CalendarEntry, daysBefore: number) =>
  createHash("sha256")
    .update(`${entry.key}|${entry.date}|${daysBefore}`)
    .digest("hex");

/** One bounded pass. Failed attempts and sent identities survive server restarts. */
export async function runNotificationCycle(
  database: Kysely<Database>,
  now = Date.now(),
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const settings = await database
    .selectFrom("notification_settings")
    .selectAll()
    .where("id", "=", "owner")
    .executeTakeFirst();
  if (
    !settings ||
    settings.enabled !== 1 ||
    !settings.endpoint ||
    !settings.destinations
  )
    return;
  const today = new Date(now).toISOString().slice(0, 10);
  const targetDay = shiftDay(today, settings.days_before);
  const entries = (
    await readCalendarEntries(
      database,
      shiftDay(today, -3),
      shiftDay(today, 30),
    )
  ).filter((entry) => entry.kind !== "completion");
  const validById = new Map(
    entries.map((entry) => [deliveryId(entry, settings.days_before), entry]),
  );
  const previous = new Set(
    (
      await database
        .selectFrom("notification_deliveries")
        .select("id")
        .execute()
    ).map((row) => row.id),
  );
  // Limit queue writes too, so a large imported collection cannot monopolize a tick.
  const due = entries
    .filter(
      (entry) =>
        entry.date === targetDay &&
        !previous.has(deliveryId(entry, settings.days_before)),
    )
    .slice(0, 100);
  if (due.length > 0) {
    await database
      .insertInto("notification_deliveries")
      .values(
        due.map((entry) => ({
          id: deliveryId(entry, settings.days_before),
          event_key: entry.key,
          event_date: entry.date,
          title: "Shelfie release reminder",
          body: `${entry.title}\n${entry.description}\nRelease date: ${entry.date}`,
          attempts: 0,
          next_attempt_at: now,
          sent_at: null,
          last_error: null,
        })),
      )
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
  }
  const pending = await database
    .selectFrom("notification_deliveries")
    .selectAll()
    .where("sent_at", "is", null)
    .where("attempts", "<", MAX_ATTEMPTS)
    .where("next_attempt_at", "<=", now)
    .orderBy("next_attempt_at")
    .orderBy("id")
    .limit(MAX_SENDS_PER_CYCLE)
    .execute();
  for (const delivery of pending) {
    // Removed items, changed dates, and old lead-time preferences cancel unsent reminders.
    if (!validById.has(delivery.id)) {
      await database
        .updateTable("notification_deliveries")
        .set({
          attempts: MAX_ATTEMPTS,
          last_error:
            "Reminder cancelled because its collection item, release date, or reminder setting changed",
        })
        .where("id", "=", delivery.id)
        .execute();
      continue;
    }
    const current = await database
      .selectFrom("notification_settings")
      .select(["enabled", "updated_at"])
      .where("id", "=", "owner")
      .executeTakeFirst();
    if (
      !current ||
      current.enabled !== 1 ||
      current.updated_at !== settings.updated_at
    )
      break;
    const attempts = delivery.attempts + 1;
    // Claim before making the external call; a crash leaves a retry after the lease.
    await database
      .updateTable("notification_deliveries")
      .set({
        attempts,
        next_attempt_at: now + 5 * 60_000 * 2 ** (attempts - 1),
      })
      .where("id", "=", delivery.id)
      .execute();
    try {
      await sendApprise(
        settings.endpoint,
        settings.destinations,
        delivery.title,
        delivery.body,
        fetcher,
      );
      await database
        .updateTable("notification_deliveries")
        .set({ sent_at: now, last_error: null })
        .where("id", "=", delivery.id)
        .execute();
    } catch (error) {
      await database
        .updateTable("notification_deliveries")
        .set({
          last_error:
            error instanceof Error ? error.message : "Apprise request failed",
        })
        .where("id", "=", delivery.id)
        .execute();
    }
  }
  // Keep six months of dedupe/status history; only current-day events can be newly queued.
  await database
    .deleteFrom("notification_deliveries")
    .where("event_date", "<", shiftDay(today, -180))
    .execute();
}

/** Single-container worker; returns cleanup for tests and graceful shutdown. */
export function startNotificationWorker(
  database: Kysely<Database> = defaultDb,
): () => Promise<void> {
  let running = false;
  let stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      await runNotificationCycle(database);
    } catch {
      console.error(
        "Shelfie notification worker could not complete its scheduled pass",
      );
    } finally {
      running = false;
    }
  };
  let activePass: Promise<void> = Promise.resolve();
  const startPass = () => {
    if (!running && !stopped) activePass = tick();
  };
  const timer = setInterval(startPass, 60_000);
  timer.unref();
  startPass();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await activePass;
  };
}
