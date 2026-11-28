import BetterSqlite3 from "better-sqlite3";
import { Hono } from "hono";
import { Kysely, SqliteDialect } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_IMPORT_POLICY,
  type ItemStatus,
  type ReplicatedLibraryItem,
} from "@shelfie/shared";
import { runMigrations } from "../db/migrations.js";
import type { Database } from "../db/types.js";
import { initSequence } from "../db/sequence.js";
import { libraryItemDocToRow, libraryItemRowToDoc } from "../sync/row.js";
import { parseCron } from "./cron.js";
import { mergeCompletions, mergeImportedItem } from "./merge.js";
import { entryFilter } from "./policy.js";
import { ImportService } from "./service.js";
import { fetchSource, sourceJson, type SourceDependencies } from "./sources.js";
import { registerImportRoutes } from "./routes.js";
import type { ImportedItem } from "./types.js";

const databases: Kysely<Database>[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const db of databases.splice(0)) await db.destroy();
});
async function database() {
  const db = new Kysely<Database>({
    dialect: new SqliteDialect({ database: new BetterSqlite3(":memory:") }),
  });
  databases.push(db);
  await runMigrations(db);
  initSequence("library_items", 0);
  return db;
}
const config = {
  account: "reader",
  baseUrl: "http://bookorbit:3000",
  apiKey: "secret-key",
  accessToken: "private-token",
};
const item = {
  mediaType: "movie" as const,
  sourceId: "1",
  status: "finished" as const,
  completions: ["2026-10-15"],
};
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
    for (const cron of [
      "* *",
      "60 * * * *",
      "*/0 * * * *",
      "* 10-2 * * *",
      "* * * * MON",
      "* * 0 * *",
    ])
      expect(() => parseCron(cron)).toThrow();
  });
});

describe("additive import merge", () => {
  it("preserves local choices and deletion, merges dates, and is idempotent", () => {
    const first = mergeImportedItem(item, null, 100)!;
    const current: ReplicatedLibraryItem = {
      ...first,
      status: "dropped",
      rating: 2,
      notes: "my note",
      completions: ["2020-01-01"],
    };
    const merged = mergeImportedItem({ ...item, rating: 5 }, current, 200)!;
    expect(merged).toMatchObject({
      status: "dropped",
      rating: 2,
      notes: "my note",
      addedAt: 100,
      updatedAt: 200,
      completions: ["2020-01-01", "2026-10-15"],
    });
    expect(mergeImportedItem(item, merged, 300)).toBeNull();
    expect(
      mergeImportedItem(item, { ...merged, _deleted: true }, 400),
    ).toBeNull();
  });
  it("sharpens a logged day into a timed completion instead of duplicating it", () => {
    // Logged by hand on the 21st; Trakt has it ending 04:50Z on the 22nd.
    const instant = "2026-11-22T04:50:00.000Z";
    expect(mergeCompletions(["2026-11-21"], [instant])).toEqual([instant]);
    // Earlier Trakt imports stored the UTC day of the start.
    expect(mergeCompletions(["2026-11-22"], [instant])).toEqual([instant]);
    // A day the instant can't fall on in any zone is another viewing.
    expect(mergeCompletions(["2026-11-19"], [instant])).toEqual([
      "2026-11-19",
      instant,
    ]);
    // Each day absorbs one instant, so a same-day rewatch still counts.
    const rewatch = "2026-11-22T07:00:00.000Z";
    expect(mergeCompletions(["2026-11-21"], [instant, rewatch])).toEqual([
      instant,
      rewatch,
    ]);
    // A bare day from the source never duplicates a timed completion.
    expect(mergeCompletions([instant], ["2026-11-21"])).toEqual([instant]);
    expect(mergeCompletions([instant], [instant])).toEqual([instant]);
  });
  it("fills unknown or day-only episode watches with source instants", () => {
    const show = {
      mediaType: "tv" as const,
      sourceId: "6",
      status: "active" as const,
    };
    const current = mergeImportedItem(
      {
        ...show,
        watchedEpisodes: {
          s1e1: "",
          s1e2: "2026-11-21",
          s1e3: "2026-01-01",
          s1e4: "2026-11-21T20:00:00.000Z",
        },
      },
      null,
      100,
    )!;
    const merged = mergeImportedItem(
      {
        ...show,
        watchedEpisodes: {
          s1e1: "2026-11-20T03:00:00.000Z",
          s1e2: "2026-11-22T04:00:00.000Z",
          s1e3: "2026-11-22T05:00:00.000Z",
          s1e4: "2026-11-21T21:00:00.000Z",
          s1e5: "",
        },
      },
      current,
      200,
    )!;
    expect(merged.watchedEpisodes).toEqual({
      s1e1: "2026-11-20T03:00:00.000Z",
      s1e2: "2026-11-22T04:00:00.000Z",
      // The owner's own day or time wins over a conflicting source.
      s1e3: "2026-01-01",
      s1e4: "2026-11-21T20:00:00.000Z",
      s1e5: "",
    });
  });
  it("fills an unset storefront but never replaces the user's choice", () => {
    const game = {
      mediaType: "game" as const,
      sourceId: "5",
      status: "backlogged" as const,
      platforms: ["PC (Microsoft Windows)"],
      storefront: "steam" as const,
    };
    const created = mergeImportedItem(game, null, 100)!;
    expect(created.storefront).toBe("steam");
    expect(
      mergeImportedItem(game, { ...created, storefront: null }, 200)
        ?.storefront,
    ).toBe("steam");
    expect(
      mergeImportedItem(game, { ...created, storefront: "gog" }, 200),
    ).toBeNull();
  });
  it("keeps manual progress units, advances Steam hours, and ignores episode key order", () => {
    const game = {
      mediaType: "game" as const,
      sourceId: "3",
      status: "active" as const,
      progressFormat: "hours" as const,
      progressValue: 7,
    };
    const current = mergeImportedItem(game, null, 100)!;
    expect(
      mergeImportedItem({ ...game, progressValue: 8 }, current, 200)
        ?.progressValue,
    ).toBe(8);
    expect(
      mergeImportedItem(
        { ...game, progressValue: 8 },
        { ...current, progressFormat: "percent", progressValue: 20 },
        200,
      ),
    ).toBeNull();
    const show = {
      mediaType: "tv" as const,
      sourceId: "4",
      status: "active" as const,
      watchedEpisodes: { s1e1: "2020-01-01", s1e2: "2020-01-02" },
    };
    const tv = mergeImportedItem(show, null, 100)!;
    expect(
      mergeImportedItem(
        {
          ...show,
          watchedEpisodes: { s1e2: "2020-01-02", s1e1: "2020-01-01" },
        },
        tv,
        200,
      ),
    ).toBeNull();
  });
});

describe("source adapters", () => {
  it("cancels an oversized response while reading bytes", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6_000_000));
        controller.enqueue(new Uint8Array(5_000_000));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream)),
    );
    await expect(sourceJson("https://example.com")).rejects.toThrow(
      "size limit",
    );
    expect(cancelled).toBe(true);
  });
  it("refuses redirects and names where the source pointed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = vi.fn(
      async () =>
        new Response(null, {
          status: 308,
          headers: {
            location: "https://bookorbit.example/api/v1/auth/me?token=secret",
          },
        }),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      sourceJson("http://bookorbit.example/api/v1/auth/me"),
    ).rejects.toThrow(
      "Source redirected to https://bookorbit.example/api/v1/auth/me. Use that address",
    );
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.redirect).toBe("manual");
    expect(warn.mock.calls.flat().join("\n")).not.toContain("secret");
    warn.mockRestore();
  });
  it("sends a User-Agent but keeps a caller-provided one", async () => {
    const fetch = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", fetch);
    await sourceJson("https://api.trakt.tv/users/a/watchlist", {
      headers: { "trakt-api-key": "k" },
    });
    await sourceJson("https://example.com", {
      headers: { "User-Agent": "custom" },
    });
    const sent = fetch.mock.calls.map(
      (call) =>
        new Headers((call as unknown as [string, RequestInit])[1].headers),
    );
    expect(sent[0].get("user-agent")).toMatch(/^Shelfie\//);
    expect(sent[0].get("trakt-api-key")).toBe("k");
    expect(sent[1].get("user-agent")).toBe("custom");
  });
  it("logs a CDN block in detail without leaking query credentials", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            "<html><head><title>Attention Required! | Cloudflare</title></head><body>blocked</body></html>",
            {
              status: 403,
              statusText: "Forbidden",
              headers: {
                "content-type": "text/html; charset=UTF-8",
                server: "cloudflare",
                "cf-ray": "abc-ORD",
              },
            },
          ),
      ),
    );
    await expect(
      sourceJson("https://api.example.com/v1/games?key=secret-key"),
    ).rejects.toThrow(/^Source request failed \(403\)/);
    const logged = warn.mock.calls.flat().join("\n");
    warn.mockRestore();
    expect(logged).toContain("api.example.com/v1/games -> 403 Forbidden");
    expect(logged).toContain("cf-ray=abc-ORD");
    expect(logged).toContain("blocked by Cloudflare");
    expect(logged).toContain('"Attention Required! | Cloudflare"');
    expect(logged).not.toContain("secret-key");
  });
  it("logs an API rejection with its body", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response('{"error":"invalid api key"}', {
            status: 403,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    await expect(sourceJson("https://api.trakt.tv/x")).rejects.toThrow("403");
    const logged = warn.mock.calls.flat().join("\n");
    warn.mockRestore();
    expect(logged).toContain("credentials rejected");
    expect(logged).not.toContain("Cloudflare");
    expect(logged).toContain('{"error":"invalid api key"}');
  });
  it("maps Steam using exact app IDs and minutes, skips unmatched apps", async () => {
    const deps: SourceDependencies = {
      request: vi.fn(async () =>
        response({
          response: {
            games: [
              { appid: 10, playtime_forever: 90, playtime_2weeks: 3 },
              { appid: 20 },
            ],
          },
        }),
      ),
      steamId: vi.fn(async (id) => (id === 10 ? 99 : null)),
    };
    const result = await fetchSource("steam", config, deps);
    expect(result.items[0]).toMatchObject({
      sourceId: "99",
      status: "active",
      progressFormat: "hours",
      progressValue: 1.5,
      platforms: ["PC (Microsoft Windows)"],
      storefront: "steam",
    });
    expect(result.skipped).toBe(1);
    expect(deps.steamId).toHaveBeenCalledWith(10);
  });
  it("combines Trakt history, watchlist and ratings, ignoring ratings of unwatched titles, without turning episodes into completion dates", async () => {
    const request: SourceDependencies["request"] = vi.fn(async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith("watchlist"))
        return response([{ type: "movie", movie: { ids: { tmdb: 1 } } }]);
      if (path.endsWith("ratings"))
        return response([
          { type: "movie", movie: { ids: { tmdb: 1 } }, rating: 9 },
          { type: "show", show: { ids: { tmdb: 2 } }, rating: 8 },
          { type: "episode", show: { ids: { tmdb: 2 } }, rating: 1 },
          // Rated but never watched or planned: ignored, as Trakt does.
          { type: "movie", movie: { ids: { tmdb: 3 } }, rating: 6 },
        ]);
      return response([
        {
          type: "movie",
          movie: { ids: { tmdb: 1 } },
          watched_at: "2026-10-15T22:00:00.000Z",
        },
        {
          type: "episode",
          show: { ids: { tmdb: 2 } },
          episode: { season: 1, number: 3 },
          // Normalized to the canonical instant form.
          watched_at: "2026-10-14T12:00:00Z",
        },
      ]);
    });
    const result = await fetchSource("trakt", config, {
      request,
      steamId: vi.fn(),
    });
    expect(result.items).toHaveLength(2);
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: "1",
          rating: 4.5,
          status: "finished",
          completions: ["2026-10-15T22:00:00.000Z"],
          activityDay: "2026-10-15",
        }),
        expect.objectContaining({
          sourceId: "2",
          rating: 4,
          status: "active",
          watchedEpisodes: { s1e3: "2026-10-14T12:00:00.000Z" },
        }),
      ]),
    );
  });
  it("imports show history as watching, with unknown dates left blank, and explains skips", async () => {
    const request: SourceDependencies["request"] = vi.fn(async (url) => {
      const { pathname } = new URL(url);
      if (pathname.endsWith("ratings"))
        return response([
          { type: "episode", show: { ids: { tmdb: 2 } }, rating: 8 },
          { type: "season", show: { ids: { tmdb: 2 } }, rating: 8 },
          { type: "movie", movie: { ids: { imdb: "tt1" } }, rating: 8 },
        ]);
      if (pathname.endsWith("history"))
        return response([
          {
            type: "episode",
            show: { ids: { tmdb: 4 } },
            episode: { season: 1, number: 1 },
            // Trakt's "date unknown" marker.
            watched_at: "1970-01-01T00:00:00.000Z",
          },
        ]);
      return response([]);
    });
    const { items, skipped, warnings } = await fetchSource("trakt", config, {
      request,
      steamId: vi.fn(),
    });
    expect(items).toEqual([
      {
        mediaType: "tv",
        sourceId: "4",
        status: "active",
        watchedEpisodes: { s1e1: "" },
      },
    ]);
    expect(skipped).toBe(3);
    expect(warnings).toEqual([
      "1 Trakt entries without a TMDB identifier were skipped.",
      "2 episode or season ratings were skipped; Shelfie rates whole titles.",
    ]);
  });
  it("plans Trakt watchlist items as backlogged and repairs earlier wishlisted ones", async () => {
    const request: SourceDependencies["request"] = vi.fn(async (url) =>
      new URL(url).pathname.endsWith("watchlist")
        ? response([
            { type: "movie", movie: { ids: { tmdb: 1 } } },
            { type: "show", show: { ids: { tmdb: 2 } } },
          ])
        : response([]),
    );
    const { items } = await fetchSource("trakt", config, {
      request,
      steamId: vi.fn(),
    });
    expect(items.map((i) => i.status)).toEqual(["backlogged", "backlogged"]);

    const planned = { ...item, status: "backlogged" as const };
    const stuck = {
      ...mergeImportedItem(planned, null, 100)!,
      status: "wishlisted" as const,
    };
    expect(mergeImportedItem(planned, stuck, 200)?.status).toBe("backlogged");
    // Books do expose a wishlist, so theirs is left alone.
    const book = {
      mediaType: "book" as const,
      sourceId: "9",
      status: "wishlisted" as const,
    };
    expect(
      mergeImportedItem(book, mergeImportedItem(book, null, 100)!, 200),
    ).toBeNull();
  });
  it("lets re-imports advance TV status but never undo local finished or dropped", () => {
    const show = {
      mediaType: "tv" as const,
      sourceId: "5",
      status: "active" as const,
      watchedEpisodes: { s1e1: "2026-01-01" },
    };
    const active = mergeImportedItem(show, null, 100)!;
    const finished = mergeImportedItem(
      { ...show, status: "finished", completions: ["2026-01-01"] },
      active,
      200,
    )!;
    expect(finished).toMatchObject({
      status: "finished",
      completions: ["2026-01-01"],
    });
    expect(mergeImportedItem(show, finished, 300)).toBeNull();
    expect(
      mergeImportedItem(
        { ...show, status: "finished" },
        { ...active, status: "dropped" },
        300,
      )?.status ?? "dropped",
    ).toBe("dropped");
  });
});

describe("persisted import jobs", () => {
  it("keeps secrets out of reads, assigns sync sequences, respects tombstones and avoids duplicate scheduled runs", async () => {
    const db = await database();
    const deleted = {
      ...mergeImportedItem({ ...item, sourceId: "2" }, null, 50)!,
      _deleted: true,
    };
    await db
      .insertInto("library_items")
      .values(libraryItemDocToRow(deleted, 1))
      .execute();
    initSequence("library_items", 1);
    const load = vi.fn(async () => ({
      items: [item, { ...item, sourceId: "2" }],
      skipped: 0,
      warnings: [],
    }));
    const service = new ImportService(db, load);
    const saved = await service.save("trakt", {
      enabled: true,
      schedule: "0 3 * * *",
      account: "reader",
      baseUrl: "",
      apiKey: "secret",
    });
    expect(JSON.stringify(saved)).not.toContain('"secret"');
    await service.tick(new Date("2026-10-17T03:00:00Z"));
    await service.tick(new Date("2026-10-17T03:00:30Z"));
    expect(load).toHaveBeenCalledTimes(1);
    const rows = await db
      .selectFrom("library_items")
      .selectAll()
      .orderBy("id")
      .execute();
    expect(rows[0]).toMatchObject({ id: "movie:1", seq: 2, deleted: 0 });
    expect(rows[1]).toMatchObject({ id: "movie:2", seq: 1, deleted: 1 });
    await service.run("trakt");
    expect(
      (await service.list()).find((row) => row.source === "trakt")?.lastResult,
    ).toMatchObject({ added: 0, updated: 0, skipped: 2 });
    await service.disconnect("trakt");
    expect((await service.list())[0].hasApiKey).toBe(false);
  });
  it("checks imported shows' progress right after the import", async () => {
    const db = await database();
    const tvProgress = vi.fn(async () => {});
    const service = new ImportService(
      db,
      async () => ({
        items: [
          item,
          {
            mediaType: "tv" as const,
            sourceId: "9",
            status: "active" as const,
            watchedEpisodes: { s1e1: "2026-10-01" },
          },
        ],
        skipped: 0,
        warnings: [],
      }),
      tvProgress,
    );
    await service.save("trakt", {
      enabled: false,
      schedule: "",
      account: "reader",
      baseUrl: "",
      apiKey: "secret",
    });
    await service.run("trakt");
    expect(tvProgress).toHaveBeenCalledWith(db, ["tv:9"]);
  });
  it("rolls back malformed source data and resets interrupted jobs after restart", async () => {
    const db = await database();
    const service = new ImportService(db, async () => ({
      items: [item, { ...item, sourceId: "invalid" }],
      skipped: 0,
      warnings: [],
    }));
    await service.save("trakt", {
      enabled: false,
      schedule: "",
      account: "reader",
      baseUrl: "",
      apiKey: "secret",
    });
    await expect(service.run("trakt")).rejects.toThrow();
    expect(await db.selectFrom("library_items").selectAll().execute()).toEqual(
      [],
    );
    expect((await service.list())[0]).toMatchObject({
      running: false,
      lastError: expect.any(String),
    });
    await db.updateTable("import_connections").set({ running: 1 }).execute();
    await service.resetInterrupted();
    expect((await service.list())[0].lastError).toContain("restart");
  });
  it("rejects bad settings and run requests without a saved source", async () => {
    const service = new ImportService(await database());
    const app = new Hono();
    registerImportRoutes(app, service);
    expect(
      (await app.request("/api/imports/trakt/run", { method: "POST" })).status,
    ).toBe(400);
    expect(
      (
        await app.request("/api/imports/trakt", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            enabled: true,
            schedule: "bad",
            account: "reader",
            baseUrl: "",
            apiKey: "secret",
          }),
        })
      ).status,
    ).toBe(400);
    await expect(
      service.save("bookorbit", {
        enabled: false,
        schedule: "",
        account: "",
        baseUrl: "https://user:password@example.com",
        accessToken: "token",
      }),
    ).rejects.toThrow();
  });
});

describe("import policies", () => {
  const game = (status: "backlogged" | "paused" | "active", hours = 1) => ({
    mediaType: "game" as const,
    sourceId: "7",
    title: "Game 7",
    status,
    progressFormat: "hours" as const,
    progressValue: hours,
  });
  const everything = {
    ...DEFAULT_IMPORT_POLICY,
    buckets: {
      completed: true,
      inProgress: true,
      backlog: true,
      wishlist: true,
      dropped: true,
    },
  };
  async function steam(items: () => ImportedItem[]) {
    const db = await database();
    const service = new ImportService(db, async () => ({
      items: items(),
      skipped: 0,
      warnings: [],
    }));
    await service.save("steam", {
      enabled: false,
      schedule: "",
      account: "76561198000000000",
      baseUrl: "",
      apiKey: "secret",
    });
    const library = async () =>
      (await db.selectFrom("library_items").selectAll().execute()).map(
        libraryItemRowToDoc,
      );
    const setStatus = (status: ItemStatus) =>
      db.updateTable("library_items").set({ status }).execute();
    return { db, service, library, setStatus };
  }

  it("imports only finished and in-progress entries by default", async () => {
    const { service, library } = await steam(() => [
      game("backlogged"),
      { ...game("active"), sourceId: "8" },
    ]);
    expect(await service.run("steam")).toMatchObject({
      added: 1,
      filtered: 1,
    });
    expect((await library()).map((doc) => doc.id)).toEqual(["game:8"]);
  });

  it("filters before IGDB lookups and by last activity", async () => {
    const steamId = vi.fn(async (app: number) => app);
    const request: SourceDependencies["request"] = vi.fn(async () =>
      response({
        response: {
          games: [
            { appid: 1, name: "Unplayed" },
            {
              appid: 2,
              name: "Old",
              playtime_forever: 60,
              rtime_last_played: Date.UTC(2019, 0, 1) / 1000,
            },
            {
              appid: 3,
              name: "Recent",
              playtime_forever: 60,
              rtime_last_played: Date.UTC(2026, 9, 1) / 1000,
            },
          ],
        },
      }),
    );
    const data = await fetchSource(
      "steam",
      config,
      { request, steamId },
      entryFilter("steam", { ...DEFAULT_IMPORT_POLICY, since: "2020-01-01" }),
    );
    expect(data.items).toEqual([
      expect.objectContaining({
        sourceId: "3",
        title: "Recent",
        activityDay: "2026-10-01",
        status: "paused",
      }),
    ]);
    expect(data.filtered).toBe(2);
    expect(steamId).toHaveBeenCalledTimes(1);
  });

  it("adds new items and updates existing ones only when allowed", async () => {
    let incoming = [game("active", 1)];
    const { service, library } = await steam(() => incoming);
    await service.save("steam", {
      enabled: false,
      schedule: "",
      account: "76561198000000000",
      baseUrl: "",
      policy: { ...everything, addNew: false },
    });
    expect(await service.run("steam")).toMatchObject({ added: 0, filtered: 1 });
    await service.save("steam", {
      enabled: false,
      schedule: "",
      account: "76561198000000000",
      baseUrl: "",
      policy: { ...everything, updateExisting: false },
    });
    expect(await service.run("steam")).toMatchObject({ added: 1 });
    incoming = [game("active", 5)];
    expect(await service.run("steam")).toMatchObject({
      updated: 0,
      filtered: 1,
    });
    expect((await library())[0].progressValue).toBe(1);
  });

  it("moves statuses only when the source's status changes, or never", async () => {
    let incoming = [game("paused")];
    const { service, library, setStatus } = await steam(() => incoming);
    await service.save("steam", {
      enabled: false,
      schedule: "",
      account: "76561198000000000",
      baseUrl: "",
      policy: everything,
    });
    await service.run("steam");
    // A status chosen by hand survives re-imports reporting the same state...
    await setStatus("backlogged");
    await service.run("steam");
    expect((await library())[0].status).toBe("backlogged");
    // ...until the source moves on.
    incoming = [game("active", 2)];
    await service.run("steam");
    expect((await library())[0].status).toBe("active");

    await service.save("steam", {
      enabled: false,
      schedule: "",
      account: "76561198000000000",
      baseUrl: "",
      policy: { ...everything, updateStatuses: false },
    });
    await setStatus("backlogged");
    incoming = [game("paused", 3)];
    await service.run("steam");
    expect((await library())[0]).toMatchObject({
      status: "backlogged",
      progressValue: 3,
    });
  });

  it("follows saved defaults unless a source has its own policy", async () => {
    const { service, library } = await steam(() => [game("backlogged")]);
    const app = new Hono();
    registerImportRoutes(app, service);
    expect(await (await app.request("/api/imports/defaults")).json()).toEqual(
      DEFAULT_IMPORT_POLICY,
    );
    const put = (body: unknown) =>
      app.request("/api/imports/defaults", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await put({ ...everything, since: "2026-02-30" })).status).toBe(
      400,
    );
    expect((await put(everything)).status).toBe(200);
    expect(await service.run("steam")).toMatchObject({ added: 1 });
    await service.save("steam", {
      enabled: false,
      schedule: "",
      account: "76561198000000000",
      baseUrl: "",
      policy: { ...everything, updateExisting: false },
    });
    expect(
      (await service.list()).find((c) => c.source === "steam")?.policy,
    ).toMatchObject({ updateExisting: false });
    expect(await service.run("steam")).toMatchObject({ filtered: 1 });
    expect(await library()).toHaveLength(1);
  });

  it("previews counts and titles per bucket without writing", async () => {
    const { db, service, library } = await steam(() => [
      game("backlogged"),
      { ...game("active"), sourceId: "8", title: "Game 8" },
    ]);
    await service.preview("steam");
    const [, , steamRow] = await service.list();
    expect(steamRow.lastPreview).toMatchObject({
      added: { inProgress: { count: 1, samples: ["Game 8"] } },
      updated: {},
      filtered: 1,
    });
    expect(await library()).toEqual([]);
    expect(await db.selectFrom("import_items").selectAll().execute()).toEqual(
      [],
    );
    await service.run("steam");
    expect((await service.list())[2].lastPreview).toBeNull();
  });
});
