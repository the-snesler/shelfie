import BetterSqlite3 from "better-sqlite3";
import { Hono } from "hono";
import { Kysely, SqliteDialect } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReplicatedLibraryItem } from "@shelfie/shared";
import { runMigrations } from "../db/migrations.js";
import type { Database } from "../db/types.js";
import { initSequence } from "../db/sequence.js";
import { libraryItemDocToRow } from "../sync/row.js";
import { parseCron } from "./cron.js";
import { mergeImportedItem } from "./merge.js";
import { ImportService } from "./service.js";
import { fetchSource, type SourceDependencies } from "./sources.js";
import { registerImportRoutes } from "./routes.js";

const databases: Kysely<Database>[] = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.destroy(); });
async function database() {
  const db = new Kysely<Database>({ dialect: new SqliteDialect({ database: new BetterSqlite3(":memory:") }) });
  databases.push(db); await runMigrations(db); initSequence("library_items", 0); return db;
}
const config = { account: "reader", baseUrl: "http://bookorbit:3000", apiKey: "secret-key", accessToken: "private-token" };
const item = { mediaType: "movie" as const, sourceId: "1", status: "finished" as const, completedDates: ["2026-10-15"] };
const response = (data: unknown) => ({ data, headers: new Headers() });

describe("UTC cron", () => {
  it("supports steps, ranges, lists, and Sunday aliases", () => {
    const matches = parseCron("*/15 3-4 * 1,10 0,7");
    expect(matches(new Date("2026-10-18T03:30:00Z"))).toBe(true);
    expect(matches(new Date("2026-10-18T03:31:00Z"))).toBe(false);
    expect(matches(new Date("2026-10-19T03:30:00Z"))).toBe(false);
    expect(parseCron("0 0 1 * 1")(new Date("2026-10-05T00:00:00Z"))).toBe(true);
  });
  it("rejects malformed and out-of-range fields", () => {
    for (const cron of ["* *", "60 * * * *", "*/0 * * * *", "* 10-2 * * *", "* * * * MON", "* * 0 * *"]) expect(() => parseCron(cron)).toThrow();
  });
});

describe("additive import merge", () => {
  it("preserves local choices and deletion, merges dates, and is idempotent", () => {
    const first = mergeImportedItem(item, null, 100)!;
    const current: ReplicatedLibraryItem = { ...first, status: "dropped", rating: 2, notes: "my note", completedDates: ["2020-01-01"] };
    const merged = mergeImportedItem({ ...item, rating: 5 }, current, 200)!;
    expect(merged).toMatchObject({ status: "dropped", rating: 2, notes: "my note", addedAt: 100, updatedAt: 200, completedDates: ["2020-01-01", "2026-10-15"] });
    expect(mergeImportedItem(item, merged, 300)).toBeNull();
    expect(mergeImportedItem(item, { ...merged, _deleted: true }, 400)).toBeNull();
  });
  it("keeps manual progress units, advances Steam hours, and ignores episode key order", () => {
    const game = { mediaType: "game" as const, sourceId: "3", status: "active" as const, progressFormat: "hours" as const, progressValue: 7 };
    const current = mergeImportedItem(game, null, 100)!;
    expect(mergeImportedItem({ ...game, progressValue: 8 }, current, 200)?.progressValue).toBe(8);
    expect(mergeImportedItem({ ...game, progressValue: 8 }, { ...current, progressFormat: "percent", progressValue: 20 }, 200)).toBeNull();
    const show = { mediaType: "tv" as const, sourceId: "4", status: "active" as const, watchedEpisodes: { s1e1: "2020-01-01", s1e2: "2020-01-02" } };
    const tv = mergeImportedItem(show, null, 100)!;
    expect(mergeImportedItem({ ...show, watchedEpisodes: { s1e2: "2020-01-02", s1e1: "2020-01-01" } }, tv, 200)).toBeNull();
  });
});

describe("source adapters", () => {
  it("maps Steam using exact app IDs and minutes, skips unmatched apps", async () => {
    const deps: SourceDependencies = { request: vi.fn(async () => response({ response: { games: [{ appid: 10, playtime_forever: 90, playtime_2weeks: 3 }, { appid: 20 }] } })), steamId: vi.fn(async id => id === 10 ? 99 : null) };
    const result = await fetchSource("steam", config, deps);
    expect(result.items[0]).toMatchObject({ sourceId: "99", status: "active", progressFormat: "hours", progressValue: 1.5 });
    expect(result.skipped).toBe(1);
    expect(deps.steamId).toHaveBeenCalledWith(10);
  });
  it("combines Trakt history, watchlist and ratings without turning episodes into completion dates", async () => {
    const request: SourceDependencies["request"] = vi.fn(async url => {
      const path = new URL(url).pathname;
      if (path.endsWith("watchlist")) return response([{ type: "movie", movie: { ids: { tmdb: 1 } } }]);
      if (path.endsWith("ratings")) return response([{ type: "movie", movie: { ids: { tmdb: 1 } }, rating: 9 }, { type: "show", show: { ids: { tmdb: 2 } }, rating: 8 }, { type: "episode", show: { ids: { tmdb: 2 } }, rating: 1 }]);
      return response([{ type: "movie", movie: { ids: { tmdb: 1 } }, watched_at: "2026-10-15T22:00:00Z" }, { type: "episode", show: { ids: { tmdb: 2 } }, episode: { season: 1, number: 3 }, watched_at: "2026-10-14T12:00:00Z" }]);
    });
    const result = await fetchSource("trakt", config, { request, steamId: vi.fn() });
    expect(result.items).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: "1", rating: 4.5, status: "finished", completedDates: ["2026-10-15"] }), expect.objectContaining({ sourceId: "2", rating: 4, status: "active", watchedEpisodes: { s1e3: "2026-10-14" } })]));
  });
  it("reads BookOrbit paged cards and detail Goodreads IDs, never local book IDs", async () => {
    const request: SourceDependencies["request"] = vi.fn(async (url, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer private-token");
      if (String(url).endsWith("query")) return response({ items: [{ id: 88, readingProgress: 23 }, { id: 89 }], total: 2 });
      return response(String(url).endsWith("88") ? { providerIds: { goodreads: "1234" }, readStatus: { status: "read", finishedAt: "2026-10-15" }, rating: 4 } : { providerIds: {} });
    });
    const result = await fetchSource("bookorbit", config, { request, steamId: vi.fn() });
    expect(result.items).toEqual([expect.objectContaining({ sourceId: "1234", status: "finished", progressValue: 23, completedDates: ["2026-10-15"] })]);
    expect(result.skipped).toBe(1);
  });
});

describe("persisted import jobs", () => {
  it("keeps secrets out of reads, assigns sync sequences, respects tombstones and avoids duplicate scheduled runs", async () => {
    const db = await database();
    const deleted = { ...mergeImportedItem({ ...item, sourceId: "2" }, null, 50)!, _deleted: true };
    await db.insertInto("library_items").values(libraryItemDocToRow(deleted, 1)).execute(); initSequence("library_items", 1);
    const load = vi.fn(async () => ({ items: [item, { ...item, sourceId: "2" }], skipped: 0, warnings: [] }));
    const service = new ImportService(db, load);
    const saved = await service.save("trakt", { enabled: true, schedule: "0 3 * * *", account: "reader", baseUrl: "", apiKey: "secret" });
    expect(JSON.stringify(saved)).not.toContain('"secret"');
    await service.tick(new Date("2026-10-17T03:00:00Z"));
    await service.tick(new Date("2026-10-17T03:00:30Z"));
    expect(load).toHaveBeenCalledTimes(1);
    const rows = await db.selectFrom("library_items").selectAll().orderBy("id").execute();
    expect(rows[0]).toMatchObject({ id: "movie:1", seq: 2, deleted: 0 });
    expect(rows[1]).toMatchObject({ id: "movie:2", seq: 1, deleted: 1 });
    await service.run("trakt");
    expect((await service.list()).find(row => row.source === "trakt")?.lastResult).toMatchObject({ added: 0, updated: 0, skipped: 2 });
    await service.disconnect("trakt"); expect((await service.list())[0].hasApiKey).toBe(false);
  });
  it("rolls back malformed source data and resets interrupted jobs after restart", async () => {
    const db = await database();
    const service = new ImportService(db, async () => ({ items: [item, { ...item, sourceId: "invalid" }], skipped: 0, warnings: [] }));
    await service.save("trakt", { enabled: false, schedule: "", account: "reader", baseUrl: "", apiKey: "secret" });
    await expect(service.run("trakt")).rejects.toThrow();
    expect(await db.selectFrom("library_items").selectAll().execute()).toEqual([]);
    expect((await service.list())[0]).toMatchObject({ running: false, lastError: expect.any(String) });
    await db.updateTable("import_connections").set({ running: 1 }).execute();
    await service.resetInterrupted(); expect((await service.list())[0].lastError).toContain("restart");
  });
  it("rejects bad settings and run requests without a saved source", async () => {
    const service = new ImportService(await database()); const app = new Hono(); registerImportRoutes(app, service);
    expect((await app.request("/api/imports/trakt/run", { method: "POST" })).status).toBe(400);
    expect((await app.request("/api/imports/trakt", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: true, schedule: "bad", account: "reader", baseUrl: "", apiKey: "secret" }) })).status).toBe(400);
    await expect(service.save("bookorbit", { enabled: false, schedule: "", account: "", baseUrl: "https://user:password@example.com", accessToken: "token" })).rejects.toThrow();
  });
});
