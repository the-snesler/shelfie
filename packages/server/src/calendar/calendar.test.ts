import BetterSqlite3 from "better-sqlite3";
import { Hono } from "hono";
import { Kysely, SqliteDialect, sql } from "kysely";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrations.js";
import type { Database } from "../db/types.js";
import { libraryItemDocToRow } from "../sync/row.js";
import {
  escapeCalendarText,
  foldCalendarLine,
  renderCalendar,
} from "./ical.js";
import { isCalendarDay, readCalendarEntries } from "./events.js";
import type * as RoutesModule from "./routes.js";

process.env.DATABASE_URL = "sqlite://:memory:";
let routes: typeof RoutesModule;
let database: Kysely<Database>;
let app: Hono;

beforeAll(async () => {
  routes = await import("./routes.js");
});
beforeEach(async () => {
  database = new Kysely<Database>({
    dialect: new SqliteDialect({ database: new BetterSqlite3(":memory:") }),
  });
  await runMigrations(database);
  app = new Hono();
  routes.registerCalendarFeedRoutes(app, database);
  app.use("/api/*", async (c, next) => {
    if (c.req.header("authorization") !== "Bearer owner")
      return c.json({ error: "unauthorized" }, 401);
    await next();
  });
  routes.registerCalendarSettingsRoutes(app, database);
});
afterEach(async () => {
  await database.destroy();
});

async function seed() {
  await database
    .insertInto("library_items")
    .values(
      libraryItemDocToRow(
        {
          id: "game:1",
          mediaType: "game",
          sourceId: "1",
          status: "wishlisted",
          platforms: [],
          progressFormat: "hours",
          progressValue: null,
          rating: null,
          notes: "PRIVATE NOTES",
          completedDates: ["2025-01-01"],
          watchedEpisodes: {},
          activity: [],
          addedAt: 1,
          updatedAt: Date.parse("2026-01-01T00:00:00Z"),
          _deleted: false,
        },
        1,
      ),
    )
    .execute();
  await sql`INSERT INTO game_metadata (igdb_id, name, genres, platforms, fetched_at, first_release_date)
    VALUES (1, 'A, game; title', '[]', '[]', 1, 1792195200)`.execute(database);
}

describe("private calendar subscription", () => {
  it("requires owner authentication for management and a secret for reads", async () => {
    expect(
      (await app.request("/api/settings/calendar", { method: "POST" })).status,
    ).toBe(401);
    expect(
      (await app.request(`/api/calendar/feed/${"a".repeat(64)}/library.ics`))
        .status,
    ).toBe(404);
    await seed();
    const created = await app.request("/api/settings/calendar", {
      method: "POST",
      headers: { authorization: "Bearer owner" },
    });
    const result = (await created.json()) as { path: string };
    const token = result.path.split("/")[4];
    const row = await database
      .selectFrom("calendar_subscription")
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(row.token_hash).not.toBe(token);
    const feed = await app.request(result.path);
    expect(feed.status).toBe(200);
    expect(feed.headers.get("content-type")).toContain("text/calendar");
    expect(feed.headers.get("cache-control")).toContain("no-store");
    const text = await feed.text();
    expect(text).toContain("SUMMARY:A\\, game\\; title");
    expect(text).toContain("SUMMARY:Completed: A\\, game\\; title");
    expect(text).not.toContain("PRIVATE NOTES");
    const status = await app.request("/api/settings/calendar", {
      headers: { authorization: "Bearer owner" },
    });
    expect(JSON.stringify(await status.json())).not.toContain(token);
  });

  it("rotates and revokes feed access immediately", async () => {
    const create = async () => {
      const response = await app.request("/api/settings/calendar", {
        method: "POST",
        headers: { authorization: "Bearer owner" },
      });
      return ((await response.json()) as { path: string }).path;
    };
    const first = await create();
    const second = await create();
    expect((await app.request(first)).status).toBe(404);
    expect((await app.request(second)).status).toBe(200);
    await app.request("/api/settings/calendar", {
      method: "DELETE",
      headers: { authorization: "Bearer owner" },
    });
    expect((await app.request(second)).status).toBe(404);
  });

  it("reads only collection metadata and keeps completion history for dropped items", async () => {
    await seed();
    await sql`INSERT INTO game_metadata (igdb_id, name, genres, platforms, fetched_at)
      VALUES (2, 'Not in collection', '[]', '[]', 1)`.execute(database);
    expect(
      (await readCalendarEntries(database)).map((entry) => entry.kind),
    ).toEqual(["completion", "release"]);
    await database
      .updateTable("library_items")
      .set({ status: "dropped" })
      .execute();
    expect(
      (await readCalendarEntries(database)).map((entry) => entry.kind),
    ).toEqual(["completion"]);
    await database.updateTable("library_items").set({ deleted: 1 }).execute();
    expect(await readCalendarEntries(database)).toEqual([]);
  });

  it("exports cached TV catalogs and next episodes once per episode, plus movie and book releases", async () => {
    await seed();
    const template = await database
      .selectFrom("library_items")
      .selectAll()
      .executeTakeFirstOrThrow();
    await database
      .insertInto("library_items")
      .values([
        {
          ...template,
          id: "tv:4",
          source_id: "4",
          media_type: "tv",
          completed_dates: "[]",
        },
        {
          ...template,
          id: "movie:2",
          source_id: "2",
          media_type: "movie",
          completed_dates: "[]",
        },
        {
          ...template,
          id: "book:3",
          source_id: "3",
          media_type: "book",
          completed_dates: "[]",
        },
      ])
      .execute();
    const episode = {
      seasonNumber: 1,
      episodeNumber: 2,
      name: "Catalog title",
      airDate: "2026-10-18",
      stillPath: null,
    };
    await sql`INSERT INTO tv_metadata (tmdb_id, name, fetched_at, seasons, next_episode)
      VALUES (4, 'A show', 1, ${JSON.stringify([{ seasonNumber: 1, episodes: [episode] }])}, ${JSON.stringify({ ...episode, name: "Card title" })})`.execute(
      database,
    );
    await sql`INSERT INTO movie_metadata (tmdb_id, name, fetched_at, release_date) VALUES (2, 'A movie', 1, '2026-10-18')`.execute(
      database,
    );
    await sql`INSERT INTO book_metadata (goodreads_id, name, fetched_at, publication_date) VALUES (3, 'A book', 1, '2026-10-18')`.execute(
      database,
    );
    const entries = await readCalendarEntries(
      database,
      "2026-10-18",
      "2026-10-18",
    );
    expect(entries).toHaveLength(3);
    expect(entries.find((entry) => entry.kind === "episode")?.description).toBe(
      "Catalog title",
    );
    expect(entries.map((entry) => entry.title)).toContain("A book");
    expect(entries.map((entry) => entry.title)).toContain("A movie");
  });
});

describe("iCalendar encoding", () => {
  it("escapes text, folds UTF-8 on octet boundaries, and uses exclusive all-day ends", () => {
    expect(escapeCalendarText("a\\b,c;d\r\nINJECT:bad")).toBe(
      "a\\\\b\\,c\\;d\\nINJECT:bad",
    );
    const line = `SUMMARY:${"📚é".repeat(40)}`;
    const folded = foldCalendarLine(line);
    expect(
      folded.split("\r\n").every((part) => Buffer.byteLength(part) <= 75),
    ).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe(line);
    const event = {
      key: "movie:2:release",
      date: "2026-12-31",
      title: "One",
      description: "A\nB",
      kind: "release" as const,
      updatedAt: 0,
    };
    const first = renderCalendar([event]);
    expect(first).toContain("DTEND;VALUE=DATE:20270101\r\n");
    expect(first.match(/UID:.+/)?.[0]).toBe(
      renderCalendar([
        { ...event, date: "2027-01-02", title: "Renamed" },
      ]).match(/UID:.+/)?.[0],
    );
    expect(first).toContain("DESCRIPTION:A\\nB");
  });

  it("rejects impossible calendar days", () => {
    expect(isCalendarDay("2026-02-30")).toBe(false);
    expect(isCalendarDay("2024-02-29")).toBe(true);
    expect(isCalendarDay("not a date")).toBe(false);
  });
});
