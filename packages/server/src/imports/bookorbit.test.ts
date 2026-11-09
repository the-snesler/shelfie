import { createHash } from "node:crypto";
import BetterSqlite3 from "better-sqlite3";
import { Hono } from "hono";
import { Kysely, SqliteDialect } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookSearchResult } from "@shelfie/shared";
import { runMigrations } from "../db/migrations.js";
import type { Database } from "../db/types.js";
import { initSequence } from "../db/sequence.js";
import { libraryItemDocToRow } from "../sync/row.js";
import {
  authorsMatch,
  GoodreadsBookMatcher,
  GoodreadsLookupError,
  RETRY_UNMATCHED_MS,
  titlesMatch,
  type BookMatch,
  type BookMatcher,
} from "./bookLinks.js";
import { mergeImportedItem } from "./merge.js";
import { registerImportRoutes } from "./routes.js";
import { ImportService } from "./service.js";
import { fetchSource, type SourceDependencies } from "./sources.js";

const databases: Kysely<Database>[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.destroy();
});
async function database(throughId = Infinity) {
  const db = new Kysely<Database>({
    dialect: new SqliteDialect({ database: new BetterSqlite3(":memory:") }),
  });
  databases.push(db);
  await runMigrations(db, throughId);
  initSequence("library_items", 0);
  return db;
}
const result = (
  goodreadsId: number,
  name: string,
  author: string,
): BookSearchResult => ({
  goodreadsId,
  name,
  authors: [author],
  year: null,
  coverUrl: null,
  pageCount: null,
});
const response = (data: unknown) => ({ data, headers: new Headers() });
const hobbit = {
  externalId: "7",
  title: "The Hobbit",
  authors: ["J.R.R. Tolkien"],
};
/** Fixture credential; not a real account. */
const FAKE_KEY = "0123456789abcdef0123456789abcdef";

describe("Goodreads title and author matching", () => {
  it("ignores series suffixes and a subtitle missing on one side", () => {
    expect(
      titlesMatch(
        "Network Effect (The Murderbot Diaries, #5)",
        "Network Effect",
      ),
    ).toBe(true);
    expect(
      titlesMatch("Frostbite", "Frostbite: How Refrigeration Changed Our Food"),
    ).toBe(true);
    expect(
      titlesMatch("The Hobbit, or There and Back Again", "The Hobbit"),
    ).toBe(true);
    expect(
      titlesMatch(
        "Death's End (Remembrance of Earth’s Past, #3)",
        "Death's End (The Three-Body Problem)",
      ),
    ).toBe(true);
    expect(titlesMatch("Dune Messiah", "Dune")).toBe(false);
    expect(
      titlesMatch("Star Wars: Thrawn", "Star Wars: Heir to the Empire"),
    ).toBe(false);
    expect(
      titlesMatch(
        "Summary of The Bullet That Missed by Richard Osman",
        "The Bullet That Missed",
      ),
    ).toBe(false);
  });
  it("compares authors without spacing, dots, or last-name-first order", () => {
    expect(authorsMatch(["S.A. Barnes"], ["S. A. Barnes"])).toBe(true);
    expect(authorsMatch(["Cashore, Kristin"], ["Kristin Cashore"])).toBe(true);
    expect(authorsMatch(["Liu, Cixin"], ["Liu Cixin"])).toBe(true);
    expect(authorsMatch(["Richard Osman"], ["Rick James"])).toBe(false);
  });
});

describe("GoodreadsBookMatcher", () => {
  it("skips summaries for a strict match and saves it, fetching no ISBN", async () => {
    const db = await database();
    const search = vi.fn(async () => [
      result(1, "Summary of The Hobbit by J.R.R. Tolkien", "Rick James"),
      result(2, "The Hobbit (Middle-earth, #0)", "J.R.R. Tolkien"),
    ]);
    const isbn = vi.fn(async () => "9780547928227");
    const matcher = new GoodreadsBookMatcher(db, "bookorbit", search);
    expect(await matcher.match(hobbit, isbn)).toEqual({
      goodreadsId: 2,
      method: "title",
    });
    expect(isbn).not.toHaveBeenCalled();
    // A later run reuses the saved match without searching.
    const again = new GoodreadsBookMatcher(db, "bookorbit", search);
    expect(await again.match(hobbit, isbn)).toMatchObject({ goodreadsId: 2 });
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("searches the title alone first, then with the first author", async () => {
    const db = await database();
    const search = vi.fn(async (q: string) =>
      q === "Death's End"
        ? [result(9, "They Both Die at the End", "Adam Silvera")]
        : [
            result(
              10,
              "Death's End (Remembrance of Earth’s Past, #3)",
              "Liu Cixin",
            ),
          ],
    );
    const matcher = new GoodreadsBookMatcher(db, "bookorbit", search);
    expect(
      await matcher.match(
        {
          externalId: "1",
          title: "Death's End (The Three-Body Problem)",
          authors: ["Liu, Cixin"],
        },
        async () => null,
      ),
    ).toEqual({ goodreadsId: 10, method: "title" });
    expect(search.mock.calls.map(([q]) => q)).toEqual([
      "Death's End",
      "Death's End Liu, Cixin",
    ]);
  });

  it("falls back to an ISBN only when it agrees with the title or author", async () => {
    const db = await database();
    const search = vi.fn(async (q: string) =>
      q === "9780547928227"
        ? [result(3, "Der Hobbit", "J.R.R. Tolkien")]
        : q === "0000000000"
          ? [result(4, "Unrelated", "Someone Else")]
          : [],
    );
    const matcher = new GoodreadsBookMatcher(db, "bookorbit", search);
    expect(
      await matcher.match(hobbit, async () => "978-0-547-92822-7"),
    ).toEqual({ goodreadsId: 3, method: "isbn" });
    expect(
      await matcher.match(
        { ...hobbit, externalId: "8" },
        async () => "0000000000",
      ),
    ).toEqual({ goodreadsId: null, method: "none" });
  });

  it("prefers an owned edition with the same title and author", async () => {
    const db = await database();
    const owned = mergeImportedItem(
      { mediaType: "book", sourceId: "55", status: "backlogged" },
      null,
      1,
    )!;
    await db
      .insertInto("library_items")
      .values(libraryItemDocToRow(owned, 1))
      .execute();
    await db
      .insertInto("book_metadata")
      .values({
        goodreads_id: 55,
        name: "The Hobbit, or There and Back Again",
        cover_url: null,
        authors: JSON.stringify(["J. R. R. Tolkien"]),
        publication_date: null,
        page_count: null,
        description: null,
        publisher: null,
        isbn13: null,
        series_name: null,
        series_position: null,
        genres: null,
        avg_rating: null,
        ratings_count: null,
        language: null,
        fetched_at: 1,
        detail_fetched_at: null,
      })
      .execute();
    const search = vi.fn(async () => []);
    const matcher = new GoodreadsBookMatcher(db, "bookorbit", search);
    expect(
      await matcher.match(
        { ...hobbit, title: "The Hobbit, or There and Back Again" },
        async () => null,
      ),
    ).toEqual({ goodreadsId: 55, method: "library" });
    expect(search).not.toHaveBeenCalled();
  });

  it("retries unmatched books after a week or a metadata edit, never manual choices", async () => {
    const db = await database();
    let now = 1_000;
    const search = vi.fn(async (): Promise<BookSearchResult[]> => []);
    const make = () =>
      new GoodreadsBookMatcher(db, "bookorbit", search, () => now);
    // Each lookup of an unmatched book runs both title searches.
    await make().match(hobbit, async () => null);
    await make().match(hobbit, async () => null);
    expect(search).toHaveBeenCalledTimes(2);
    now += RETRY_UNMATCHED_MS + 1;
    await make().match(hobbit, async () => null);
    expect(search).toHaveBeenCalledTimes(4);
    await make().match({ ...hobbit, title: "The Hobbit!" }, async () => null);
    expect(search).toHaveBeenCalledTimes(6);

    const service = new ImportService(db, vi.fn());
    await service.setBookLink("bookorbit", "7", 99);
    now += RETRY_UNMATCHED_MS + 1;
    expect(
      await make().match({ ...hobbit, title: "Renamed" }, async () => null),
    ).toEqual({ goodreadsId: 99, method: "manual" });
    expect(search).toHaveBeenCalledTimes(6);
  });

  it("does not overwrite a manual link saved while a run was searching", async () => {
    const db = await database();
    const service = new ImportService(db, vi.fn());
    // Seed the row so the concurrent manual update has something to change.
    await new GoodreadsBookMatcher(db, "bookorbit", async () => []).match(
      { ...hobbit, title: "Old title" },
      async () => null,
    );
    const matcher = new GoodreadsBookMatcher(db, "bookorbit", async () => {
      await service.setBookLink("bookorbit", "7", 42);
      return [];
    });
    await matcher.match(hobbit, async () => null);
    expect(await service.listBookLinks("bookorbit")).toEqual([
      expect.objectContaining({ goodreadsId: 42, method: "manual" }),
    ]);
  });

  it("reports failed searches without saving the book", async () => {
    const db = await database();
    const matcher = new GoodreadsBookMatcher(db, "bookorbit", async () => {
      throw new Error("Goodreads search failed: 503");
    });
    await expect(
      matcher.match(hobbit, async () => null),
    ).rejects.toBeInstanceOf(GoodreadsLookupError);
    expect(
      await db.selectFrom("import_book_links").selectAll().execute(),
    ).toEqual([]);
  });
});

describe("BookOrbit KOReader catalog adapter", () => {
  const config = {
    account: "reader",
    baseUrl: "https://bookorbit.example",
    apiKey: FAKE_KEY,
    accessToken: "",
  };
  const card = (id: number, extra: Record<string, unknown> = {}) => ({
    id,
    title: `Book ${id}`,
    authors: ["Author"],
    progressPercentage: 0,
    readStatus: "unread",
    lastReadAt: null,
    ...extra,
  });

  function setup(
    pages: unknown[][],
    matches: Record<string, BookMatch | Error>,
    details: Record<string, unknown> = {},
  ) {
    const request: SourceDependencies["request"] = vi.fn(async (url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("x-auth-user")).toBe("reader");
      expect(headers.get("x-auth-key")).toBe(FAKE_KEY);
      expect(headers.get("authorization")).toBeNull();
      const path = new URL(String(url));
      expect(path.pathname.startsWith("/api/v1/koreader/plugin/catalog/")).toBe(
        true,
      );
      const page = path.searchParams.get("page");
      if (page)
        return response({
          items: pages[Number(page) - 1] ?? [],
          total: pages.flat().length,
          hasNext: Number(page) < pages.length,
        });
      return response(details[path.pathname.split("/").pop()!] ?? {});
    });
    const books: BookMatcher = {
      match: vi.fn(async (book, isbn) => {
        const match = matches[book.externalId];
        if (match instanceof Error) throw match;
        if (match.method === "isbn") await isbn();
        return match;
      }),
      known: vi.fn(async (book) => {
        const match = matches[book.externalId];
        return match instanceof Error ? undefined : match;
      }),
    };
    return { request, books };
  }

  it("maps status, progress, ratings and last-read finish days across pages", async () => {
    const pages = [
      [
        card(1, {
          readStatus: "read",
          progressPercentage: 100,
          lastReadAt: "2026-11-01T15:53:57.000Z",
        }),
        ...Array.from({ length: 99 }, (_, i) => card(100 + i)),
      ],
      [card(2, { readStatus: "reading", progressPercentage: 42.4 })],
    ];
    const matches: Record<string, BookMatch> = {
      "1": { goodreadsId: 11, method: "title" },
      "2": { goodreadsId: 22, method: "isbn" },
    };
    for (let i = 0; i < 99; i++)
      matches[String(100 + i)] = { goodreadsId: 1000 + i, method: "title" };
    const { request, books } = setup(pages, matches, {
      "1": { rating: 4 },
      "2": { isbn13: "9780000000002", rating: null },
    });
    const data = await fetchSource("bookorbit", config, {
      request,
      steamId: vi.fn(),
      books,
    });
    expect(data.items).toHaveLength(101);
    expect(data.items[0]).toEqual({
      mediaType: "book",
      sourceId: "11",
      status: "finished",
      rating: 4,
      progressFormat: "percent",
      progressValue: 100,
      fallbackCompletedDate: "2026-11-01",
    });
    expect(data.items[1]).toMatchObject({
      sourceId: "1000",
      status: "backlogged",
      progressValue: null,
      rating: undefined,
    });
    expect(data.items[100]).toMatchObject({
      sourceId: "22",
      status: "active",
      progressValue: 42,
    });
    // One detail request per tracked book, shared by ISBN and rating.
    const detailCalls = vi
      .mocked(request)
      .mock.calls.filter(([url]) => /\/books\/\d+$/.test(String(url)));
    expect(detailCalls.map(([url]) => String(url))).toEqual([
      "https://bookorbit.example/api/v1/koreader/plugin/catalog/books/1",
      "https://bookorbit.example/api/v1/koreader/plugin/catalog/books/2",
    ]);
  });

  it("skips ignored books quietly, warns about unmatched ones, and stops searching after repeated failures", async () => {
    const failure = new GoodreadsLookupError("down");
    const { request, books } = setup(
      [[card(1), card(2), card(3), card(4), card(5), card(6), card(7)]],
      {
        "1": { goodreadsId: null, method: "ignored" },
        "2": { goodreadsId: null, method: "none" },
        "3": failure,
        "4": failure,
        "5": failure,
        "6": failure,
        "7": { goodreadsId: 77, method: "manual" },
      },
    );
    const data = await fetchSource("bookorbit", config, {
      request,
      steamId: vi.fn(),
      books,
    });
    expect(data.items.map((item) => item.sourceId)).toEqual(["77"]);
    expect(data.skipped).toBe(6);
    expect(data.warnings).toEqual([
      expect.stringContaining("1 BookOrbit books have no Goodreads match"),
      expect.stringContaining("4 BookOrbit books could not be matched"),
    ]);
    // After three failures the remaining books use saved matches only.
    expect(books.match).toHaveBeenCalledTimes(5);
    expect(books.known).toHaveBeenCalledTimes(2);
  });

  it("fails the run for errors that are not Goodreads lookups", async () => {
    const { request, books } = setup([[card(1)]], {
      "1": new Error("database is locked"),
    });
    await expect(
      fetchSource("bookorbit", config, { request, steamId: vi.fn(), books }),
    ).rejects.toThrow("database is locked");
  });
});

describe("book import merge", () => {
  const base = {
    mediaType: "book" as const,
    sourceId: "9",
    progressFormat: "percent" as const,
  };
  it("advances queued books and percent progress but never undoes local choices", () => {
    const queued = mergeImportedItem(
      { ...base, status: "backlogged", progressValue: null },
      null,
      1,
    )!;
    const reading = mergeImportedItem(
      { ...base, status: "active", progressValue: 30 },
      queued,
      2,
    )!;
    expect(reading).toMatchObject({ status: "active", progressValue: 30 });
    expect(
      mergeImportedItem(
        { ...base, status: "active", progressValue: 10 },
        reading,
        3,
      ),
    ).toBeNull();
    expect(
      mergeImportedItem(
        {
          ...base,
          status: "finished",
          progressValue: 100,
          fallbackCompletedDate: "2026-11-01",
        },
        { ...reading, status: "dropped" },
        4,
      ),
    ).toMatchObject({ status: "dropped", completedDates: [] });
    const finished = mergeImportedItem(
      {
        ...base,
        status: "finished",
        progressValue: 100,
        fallbackCompletedDate: "2026-11-01",
      },
      reading,
      5,
    )!;
    expect(finished).toMatchObject({
      status: "finished",
      progressValue: 100,
      completedDates: ["2026-11-01"],
    });
    // A reread in the source leaves the book finished in Shelfie.
    expect(
      mergeImportedItem(
        { ...base, status: "active", progressValue: 5 },
        finished,
        6,
      ),
    ).toBeNull();
  });
  it("backfills the last-read day only when a finished book has no dates", () => {
    const incoming = {
      ...base,
      status: "finished" as const,
      fallbackCompletedDate: "2026-11-01",
    };
    expect(mergeImportedItem(incoming, null, 1)?.completedDates).toEqual([
      "2026-11-01",
    ]);
    const dated = {
      ...mergeImportedItem(incoming, null, 1)!,
      completedDates: ["2025-01-01"],
    };
    expect(mergeImportedItem(incoming, dated, 2)).toBeNull();
  });
});

describe("BookOrbit connection settings and links", () => {
  it("hashes a plain KOReader password, accepts the sync URL, and drops old tokens", async () => {
    const db = await database();
    const service = new ImportService(db, vi.fn());
    const apiKey = async () =>
      (
        await db
          .selectFrom("import_connections")
          .select("api_key")
          .executeTakeFirstOrThrow()
      ).api_key;
    await service.save("bookorbit", {
      enabled: false,
      schedule: "",
      account: "reader",
      baseUrl: "https://bookorbit.example/api/v1/koreader/",
      apiKey: "plain password",
      accessToken: "old-bearer",
    });
    expect(
      await db
        .selectFrom("import_connections")
        .select(["base_url", "access_token"])
        .executeTakeFirstOrThrow(),
    ).toEqual({ base_url: "https://bookorbit.example", access_token: "" });
    expect(await apiKey()).toBe(
      createHash("md5").update("plain password").digest("hex"),
    );
    await service.save("bookorbit", {
      enabled: false,
      schedule: "",
      account: "reader",
      baseUrl: "https://bookorbit.example",
      apiKey: FAKE_KEY.toUpperCase(),
    });
    expect(await apiKey()).toBe(FAKE_KEY);
    await expect(
      service.save("bookorbit", {
        enabled: false,
        schedule: "",
        account: "",
        baseUrl: "https://bookorbit.example",
      }),
    ).rejects.toThrow("KOReader");
  });

  it("pauses an old bearer-token connection when migrating", async () => {
    const db = await database(15);
    await db
      .insertInto("import_connections")
      .values({
        source: "bookorbit",
        enabled: 1,
        schedule: "0 3 * * *",
        account: "",
        base_url: "https://bookorbit.example",
        api_key: "",
        access_token: "expired-bearer",
        running: 0,
        last_slot: null,
        last_run_at: null,
        last_error: null,
        last_result: null,
      })
      .execute();
    await runMigrations(db);
    const service = new ImportService(db, vi.fn());
    expect(
      (await service.list()).find((row) => row.source === "bookorbit"),
    ).toMatchObject({
      enabled: false,
      schedule: "",
      hasAccessToken: false,
      lastError: expect.stringContaining("KOReader"),
    });
    await service.save("bookorbit", {
      enabled: false,
      schedule: "",
      account: "reader",
      baseUrl: "https://bookorbit.example",
      apiKey: FAKE_KEY,
    });
    expect(
      (await service.list()).find((row) => row.source === "bookorbit")
        ?.lastError,
    ).toBeNull();
  });

  it("lists, links, ignores and resets matches over HTTP; disconnect forgets them", async () => {
    const db = await database();
    const service = new ImportService(db, vi.fn());
    await new GoodreadsBookMatcher(db, "bookorbit", async () => []).match(
      hobbit,
      async () => null,
    );
    const app = new Hono();
    registerImportRoutes(app, service);
    const put = (body: unknown, id = "7") =>
      app.request(`/api/imports/bookorbit/links/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    expect(
      await (await app.request("/api/imports/bookorbit/links")).json(),
    ).toEqual([
      expect.objectContaining({
        externalId: "7",
        title: "The Hobbit",
        authors: ["J.R.R. Tolkien"],
        goodreadsId: null,
        method: "none",
      }),
    ]);
    expect((await app.request("/api/imports/steam/links")).status).toBe(404);
    expect((await put({ goodreadsId: "5" })).status).toBe(400);
    expect((await put({ goodreadsId: 5 }, "999")).status).toBe(404);
    expect(await (await put({ goodreadsId: 5 })).json()).toMatchObject({
      goodreadsId: 5,
      method: "manual",
    });
    expect(await (await put({ goodreadsId: null })).json()).toMatchObject({
      goodreadsId: null,
      method: "ignored",
    });
    expect(
      (
        await app.request("/api/imports/bookorbit/links/7", {
          method: "DELETE",
        })
      ).status,
    ).toBe(200);
    expect(await service.listBookLinks("bookorbit")).toEqual([]);

    await new GoodreadsBookMatcher(db, "bookorbit", async () => []).match(
      hobbit,
      async () => null,
    );
    await service.disconnect("bookorbit");
    expect(await service.listBookLinks("bookorbit")).toEqual([]);
  });
});
