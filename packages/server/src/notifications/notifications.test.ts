import BetterSqlite3 from "better-sqlite3";
import { Hono } from "hono";
import { Kysely, SqliteDialect, sql } from "kysely";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { runMigrations } from "../db/migrations.js";
import type { Database } from "../db/types.js";
import { libraryItemDocToRow } from "../sync/row.js";
import type * as RoutesModule from "./routes.js";
import type * as WorkerModule from "./worker.js";

process.env.DATABASE_URL = "sqlite://:memory:";
let routes: typeof RoutesModule;
let worker: typeof WorkerModule;
let database: Kysely<Database>;
let app: Hono;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
const now = Date.parse("2026-10-17T09:00:00Z");

beforeAll(async () => {
  routes = await import("./routes.js");
  worker = await import("./worker.js");
});
beforeEach(async () => {
  database = new Kysely<Database>({
    dialect: new SqliteDialect({ database: new BetterSqlite3(":memory:") }),
  });
  await runMigrations(database);
  fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response("OK"));
  app = new Hono();
  routes.registerNotificationRoutes(app, database, fetcher);
});
afterEach(async () => {
  await database.destroy();
});

async function configure(enabled = true, daysBefore = 0) {
  return app.request("/api/settings/notifications", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      enabled,
      endpoint: "http://apprise:8000",
      destinations: "ntfy://ntfy.sh/private-secret",
      daysBefore,
    }),
  });
}

async function seed(count = 1) {
  for (let id = 1; id <= count; id++) {
    await database
      .insertInto("library_items")
      .values(
        libraryItemDocToRow(
          {
            id: `game:${id}`,
            mediaType: "game",
            sourceId: String(id),
            status: "wishlisted",
            platforms: [],
            progressFormat: "hours",
            progressValue: null,
            rating: null,
            notes: "",
            completedDates: ["2026-10-17"],
            watchedEpisodes: {},
            activity: [],
            addedAt: 1,
            updatedAt: 1,
            _deleted: false,
          },
          id,
        ),
      )
      .execute();
    await sql`INSERT INTO game_metadata (igdb_id, name, genres, platforms, fetched_at, first_release_date)
      VALUES (${id}, ${`Game ${id}`}, '[]', '[]', 1, ${Date.parse("2026-10-17T00:00:00Z") / 1000})`.execute(
      database,
    );
  }
}

describe("notification settings", () => {
  it("saves without sending, hides destination credentials, and retains omitted destinations", async () => {
    const configured = await configure();
    expect(configured.status).toBe(200);
    expect(JSON.stringify(await configured.json())).not.toContain(
      "private-secret",
    );
    const saved = await app.request("/api/settings/notifications", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabled: false,
        endpoint: "http://apprise:8000",
        daysBefore: 1,
      }),
    });
    expect(saved.status).toBe(200);
    expect(
      (
        await database
          .selectFrom("notification_settings")
          .selectAll()
          .executeTakeFirstOrThrow()
      ).destinations,
    ).toContain("private-secret");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("validates URLs and sends a test only on explicit request", async () => {
    const invalid = await app.request("/api/settings/notifications", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        endpoint: "file:///tmp/bad",
        destinations: "bad",
        daysBefore: 0,
      }),
    });
    expect(invalid.status).toBe(400);
    await configure(false);
    expect(
      (
        await app.request("/api/settings/notifications/test", {
          method: "POST",
        })
      ).status,
    ).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("http://apprise:8000/notify/");
    expect(
      (
        await app.request("/api/settings/notifications/test", {
          method: "POST",
        })
      ).status,
    ).toBe(429);
  });
});

describe("release reminder worker", () => {
  it("sends owned releases once across passes and persists dedupe", async () => {
    await configure();
    await seed();
    await worker.runNotificationCycle(database, now, fetcher);
    await worker.runNotificationCycle(database, now + 60_000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string).body).toContain(
      "Game 1",
    );
    const row = await database
      .selectFrom("notification_deliveries")
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(row.sent_at).toBe(now);
    expect(row.attempts).toBe(1);
  });

  it("backs off failed requests and retries after a restart without exposing upstream secrets", async () => {
    await configure();
    await seed();
    fetcher.mockImplementationOnce(
      async () => new Response("Credentials: secret", { status: 503 }),
    );
    await worker.runNotificationCycle(database, now, fetcher);
    await worker.runNotificationCycle(database, now + 60_000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const row = await database
      .selectFrom("notification_deliveries")
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(row.last_error).toBe("Apprise returned HTTP 503");
    await worker.runNotificationCycle(database, now + 5 * 60_000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      (
        await database
          .selectFrom("notification_deliveries")
          .selectAll()
          .executeTakeFirstOrThrow()
      ).sent_at,
    ).not.toBeNull();
  });

  it("honors disabled settings, lead days, deletion, and the per-pass send limit", async () => {
    await configure(false);
    await seed(7);
    await worker.runNotificationCycle(database, now, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    await configure(true, 1);
    await worker.runNotificationCycle(
      database,
      now - 24 * 60 * 60_000,
      fetcher,
    );
    expect(fetcher).toHaveBeenCalledTimes(5);
    await database.updateTable("library_items").set({ deleted: 1 }).execute();
    await worker.runNotificationCycle(
      database,
      now - 24 * 60 * 60_000 + 60_000,
      fetcher,
    );
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect((await routes.readNotificationSettings(database)).failed).toBe(2);
  });

  it("stops retrying after five failures", async () => {
    await configure();
    await seed();
    fetcher.mockImplementation(
      async () => new Response("Unavailable", { status: 503 }),
    );
    for (const minutes of [0, 5, 15, 35, 75, 155]) {
      await worker.runNotificationCycle(
        database,
        now + minutes * 60_000,
        fetcher,
      );
    }
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect((await routes.readNotificationSettings(database)).failed).toBe(1);
  });
});
