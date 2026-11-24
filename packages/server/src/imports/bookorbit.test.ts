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
/** Adds a book to the library with cached Goodreads card metadata. */
async function own(
  db: Kysely<Database>,
  goodreadsId: number,
  name: string,
  author: string,
) {
  const owned = mergeImportedItem(
    { mediaType: "book", sourceId: String(goodreadsId), status: "backlogged" },
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
      goodreads_id: goodreadsId,
      name,
      cover_url: null,
      authors: JSON.stringify([author]),
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
const noHints = async () => ({ goodreadsId: null, isbn: null });
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
    const hints = vi.fn(async () => ({
      goodreadsId: null,
      isbn: "9780547928227",
    }));
    const matcher = new GoodreadsBookMatcher(db, "bookorbit", search);
    expect(await matcher.match(hobbit, hints)).toEqual({
      goodreadsId: 2,
      method: "title",
    });
    expect(hints).toHaveBeenCalledTimes(1);
    // A later run reuses the saved match without searching or loading hints.
    const again = new GoodreadsBookMatcher(db, "bookorbit", search);
    expect(await again.match(hobbit, hints)).toMatchObject({ goodreadsId: 2 });
    expect(search).toHaveBeenCalledTimes(1);
    expect(hints).toHaveBeenCalledTimes(1);
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
        noHints,
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
      await matcher.match(hobbit, async () => ({
        goodreadsId: null,
        isbn: "978-0-547-92822-7",
      })),
    ).toEqual({ goodreadsId: 3, method: "isbn" });
    expect(
      await matcher.match({ ...hobbit, externalId: "8" }, async () => ({
        goodreadsId: null,
        isbn: "0000000000",
      })),
    ).toEqual({ goodreadsId: null, method: "none" });
  });

  it("maps the source's Goodreads id to the best edition before searching", async () => {
    const db = await database();
    const search = vi.fn(async () => [
      result(2, "The Hobbit", "J.R.R. Tolkien"),
    ]);
    const bestEdition = vi.fn(async (id: number) => (id === 70 ? 5907 : null));
    const matcher = new GoodreadsBookMatcher(
      db,
      "bookorbit",
      search,
      Date.now,
      bestEdition,
    );
    expect(
      await matcher.match(hobbit, async () => ({
        goodreadsId: 70,
        isbn: null,
      })),
    ).toEqual({ goodreadsId: 5907, method: "source" });
    expect(search).not.toHaveBeenCalled();
    expect(await matcher.known(hobbit)).toEqual({
      goodreadsId: 5907,
      method: "source",
    });
    // An id Goodreads does not know falls back to title search.
    expect(
      await matcher.match({ ...hobbit, externalId: "8" }, async () => ({
        goodreadsId: 71,
        isbn: null,
      })),
    ).toEqual({ goodreadsId: 2, method: "title" });
  });

  it("keeps an owned edition the source names exactly, without a lookup", async () => {
    const db = await database();
    await own(db, 70, "Some Other Title", "Someone");
    const bestEdition = vi.fn(async () => 5907);
    const matcher = new GoodreadsBookMatcher(
      db,
      "bookorbit",
      async () => [],
      Date.now,
      bestEdition,
    );
    expect(
      await matcher.match(hobbit, async () => ({
        goodreadsId: 70,
        isbn: null,
      })),
    ).toEqual({ goodreadsId: 70, method: "library" });
    expect(bestEdition).not.toHaveBeenCalled();
  });

  it("reports a failed edition lookup without saving the book", async () => {
    const db = await database();
    const matcher = new GoodreadsBookMatcher(
      db,
      "bookorbit",
      async () => [],
      Date.now,
      async () => {
        throw new Error("Goodreads GraphQL fetch failed: 503");
      },
    );
    await expect(
      matcher.match(hobbit, async () => ({ goodreadsId: 70, isbn: null })),
    ).rejects.toBeInstanceOf(GoodreadsLookupError);
    expect(
      await db.selectFrom("import_book_links").selectAll().execute(),
    ).toEqual([]);
  });

  it("prefers an owned edition with the same title and author", async () => {
    const db = await database();
    await own(
      db,
      55,
      "The Hobbit, or There and Back Again",
      "J. R. R. Tolkien",
    );
    const search = vi.fn(async () => []);
    const matcher = new GoodreadsBookMatcher(db, "bookorbit", search);
    expect(
      await matcher.match(
        { ...hobbit, title: "The Hobbit, or There and Back Again" },
        noHints,
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
    await make().match(hobbit, noHints);
    await make().match(hobbit, noHints);
    expect(search).toHaveBeenCalledTimes(2);
    now += RETRY_UNMATCHED_MS + 1;
    await make().match(hobbit, noHints);
    expect(search).toHaveBeenCalledTimes(4);
    await make().match({ ...hobbit, title: "The Hobbit!" }, noHints);
    expect(search).toHaveBeenCalledTimes(6);

    const service = new ImportService(db, vi.fn());
    await service.setBookLink("bookorbit", "7", 99);
    now += RETRY_UNMATCHED_MS + 1;
    expect(
      await make().match({ ...hobbit, title: "Renamed" }, noHints),
    ).toEqual({ goodreadsId: 99, method: "manual" });
    expect(search).toHaveBeenCalledTimes(6);
  });

  it("does not overwrite a manual link saved while a run was searching", async () => {
    const db = await database();
    const service = new ImportService(db, vi.fn());
    // Seed the row so the concurrent manual update has something to change.
    await new GoodreadsBookMatcher(db, "bookorbit", async () => []).match(
      { ...hobbit, title: "Old title" },
      noHints,
    );
    const matcher = new GoodreadsBookMatcher(db, "bookorbit", async () => {
      await service.setBookLink("bookorbit", "7", 42);
      return [];
    });
    await matcher.match(hobbit, noHints);
    expect(await service.listBookLinks("bookorbit")).toEqual([
      expect.objectContaining({ goodreadsId: 42, method: "manual" }),
    ]);
  });

  it("reports failed searches without saving the book", async () => {
    const db = await database();
    const matcher = new GoodreadsBookMatcher(db, "bookorbit", async () => {
      throw new Error("Goodreads search failed: 503");
    });
    await expect(matcher.match(hobbit, noHints)).rejects.toBeInstanceOf(
      GoodreadsLookupError,
    );
    expect(
      await db.selectFrom("import_book_links").selectAll().execute(),
    ).toEqual([]);
  });
});

describe("BookOrbit API adapter", () => {
  const config = {
    account: "",
    baseUrl: "https://bookorbit.example",
    apiKey: FAKE_KEY,
    accessToken: "",
  };
  /** Shaped like a `POST /api/v1/books/query` item, trimmed to what is read. */
  const card = (id: number, extra: Record<string, unknown> = {}) => ({
    id,
    libraryId: 5,
    status: "present",
    title: `Book ${id}`,
    authors: ["Author"],
    rating: null,
    readingProgress: null,
    readStatus: null,
    isbn13: null,
    ...extra,
  });
  const readStatus = (status: string) => ({
    status,
    source: "auto",
    startedAt: "2026-10-15T00:00:00.000Z",
    finishedAt: null,
    updatedAt: "2026-10-30T22:04:55.856Z",
  });
  /** Shaped like a `GET /api/v1/reading-history` item. */
  const read = (bookId: number, extra: Record<string, unknown> = {}) => ({
    id: bookId * 10,
    bookId,
    startedOn: "2026-11-06",
    endedOn: "2026-11-11",
    outcome: "completed",
    readNumber: 1,
    sessions: 17,
    sources: ["kobo"],
    rating: null,
    ...extra,
  });

  function setup(
    pages: unknown[][],
    matches: Record<string, BookMatch | Error>,
    {
      details = {},
      history = [],
    }: { details?: Record<string, unknown>; history?: unknown[] } = {},
  ) {
    const request: SourceDependencies["request"] = vi.fn(async (url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${FAKE_KEY}`);
      expect(headers.get("x-auth-key")).toBeNull();
      const path = new URL(String(url));
      if (path.pathname === "/api/v1/auth/me")
        return response({ id: 1, username: "reader" });
      if (path.pathname === "/api/v1/reading-history") {
        const offset = Number(path.searchParams.get("offset"));
        const limit = Number(path.searchParams.get("limit"));
        expect(limit).toBe(200);
        return response({
          offset,
          limit,
          total: history.length,
          items: history.slice(offset, offset + limit),
        });
      }
      if (path.pathname === "/api/v1/books/query") {
        expect(init?.method).toBe("POST");
        expect(headers.get("content-type")).toBe("application/json");
        const { pagination } = JSON.parse(String(init?.body));
        expect(pagination.size).toBe(200);
        return response({
          items: pages[pagination.page] ?? [],
          total: pages.flat().length,
          page: pagination.page,
          size: pagination.size,
        });
      }
      const id = /^\/api\/v1\/books\/(\d+)$/.exec(path.pathname)?.[1];
      if (id) return response(details[id] ?? {});
      throw new Error(`unexpected request ${path.pathname}`);
    });
    const hints: Record<string, unknown> = {};
    const books: BookMatcher = {
      match: vi.fn(async (book, loadHints) => {
        const match = matches[book.externalId];
        if (match instanceof Error) throw match;
        if (match.method !== "manual")
          hints[book.externalId] = await loadHints();
        return match;
      }),
      known: vi.fn(async (book) => {
        const match = matches[book.externalId];
        return match instanceof Error ? undefined : match;
      }),
    };
    return { request, books, hints };
  }

  it("maps status, progress, ratings and finish days across pages", async () => {
    const pages = [
      [
        card(1, {
          readStatus: readStatus("read"),
          readingProgress: 100,
          rating: 4,
        }),
        ...Array.from({ length: 199 }, (_, i) => card(100 + i)),
      ],
      [
        card(2, {
          readStatus: readStatus("reading"),
          readingProgress: 42.4,
        }),
        card(3, { readStatus: readStatus("on_hold"), readingProgress: 0.13 }),
        card(4, { readingProgress: 7 }),
      ],
    ];
    const matches: Record<string, BookMatch> = {
      "1": { goodreadsId: 11, method: "source" },
      "2": { goodreadsId: 22, method: "title" },
      "3": { goodreadsId: 33, method: "manual" },
      "4": { goodreadsId: 44, method: "manual" },
    };
    for (let i = 0; i < 199; i++)
      matches[String(100 + i)] = { goodreadsId: 1000 + i, method: "manual" };
    const { request, books } = setup(pages, matches, {
      history: [
        // A reread: both finishes count.
        read(1, { endedOn: "2026-10-15", readNumber: 2 }),
        read(1, { endedOn: "2026-10-14", sources: ["web"], sessions: 1 }),
        read(1, { endedOn: "2026-10-14", sources: ["kobo"], readNumber: 3 }),
        read(2, { outcome: "abandoned", endedOn: "2026-10-01" }),
        read(3, { outcome: "skimmed", endedOn: "2026-09-01" }),
      ],
    });
    const data = await fetchSource("bookorbit", config, {
      request,
      steamId: vi.fn(),
      books,
    });
    expect(data.account).toBe("reader");
    expect(data.items).toHaveLength(203);
    expect(data.items[0]).toEqual({
      mediaType: "book",
      sourceId: "11",
      title: "Book 1",
      // The status change outdates the latest finish.
      activityDay: "2026-10-30",
      status: "finished",
      rating: 4,
      progressFormat: "percent",
      progressValue: 100,
      completions: ["2026-10-15", "2026-10-14"],
    });
    expect(data.items[1]).toEqual({
      mediaType: "book",
      sourceId: "1000",
      title: "Book 100",
      status: "backlogged",
      rating: undefined,
      progressFormat: "percent",
      progressValue: null,
    });
    // An abandoned past attempt neither drops the book nor dates it.
    expect(data.items[200]).toEqual({
      mediaType: "book",
      sourceId: "22",
      title: "Book 2",
      activityDay: "2026-10-30",
      status: "active",
      rating: undefined,
      progressFormat: "percent",
      progressValue: 42,
    });
    // Status comes from the book, not from past reads; under 0.5% is none.
    expect(data.items[201]).toMatchObject({
      sourceId: "33",
      status: "paused",
      progressValue: null,
      completions: ["2026-09-01"],
    });
    // Unread with progress reads as active.
    expect(data.items[202]).toMatchObject({ sourceId: "44", status: "active" });
    expect(
      vi
        .mocked(request)
        .mock.calls.map(([url]) => new URL(String(url)).pathname)
        .filter((path) => path !== "/api/v1/books/query"),
    ).toEqual([
      "/api/v1/auth/me",
      "/api/v1/reading-history",
      // Details only for the books matched afresh.
      "/api/v1/books/1",
      "/api/v1/books/2",
    ]);
  });

  it("leaves out finish days of reads marked by hand without sessions", async () => {
    const { request, books } = setup(
      [[card(1, { readStatus: { ...readStatus("read"), source: "manual" } })]],
      { "1": { goodreadsId: 11, method: "manual" } },
      {
        history: [
          read(1, {
            startedOn: null,
            endedOn: "2026-10-14",
            sessions: 0,
            sources: [],
          }),
        ],
      },
    );
    const data = await fetchSource("bookorbit", config, {
      request,
      steamId: vi.fn(),
      books,
    });
    expect(data.items).toEqual([
      expect.objectContaining({ status: "finished" }),
    ]);
    expect(data.items[0].completions).toBeUndefined();
  });

  it("pages reading history by offset", async () => {
    const history = Array.from({ length: 201 }, (_, i) =>
      read(1, { id: i, endedOn: i === 200 ? "2026-11-02" : "2026-11-01" }),
    );
    const { request, books } = setup(
      [[card(1, { readStatus: readStatus("read") })]],
      { "1": { goodreadsId: 11, method: "manual" } },
      { history },
    );
    const data = await fetchSource("bookorbit", config, {
      request,
      steamId: vi.fn(),
      books,
    });
    expect(new Set(data.items[0].completions)).toEqual(
      new Set(["2026-11-01", "2026-11-02"]),
    );
    expect(
      vi
        .mocked(request)
        .mock.calls.map(([url]) => String(url))
        .filter((url) => url.includes("reading-history")),
    ).toEqual([
      "https://bookorbit.example/api/v1/reading-history?offset=0&limit=200",
      "https://bookorbit.example/api/v1/reading-history?offset=200&limit=200",
    ]);
  });

  it("loads Goodreads id and ISBN hints from the book detail", async () => {
    const { request, books, hints } = setup(
      [[card(1), card(2, { isbn13: "9780000000002" }), card(3)]],
      {
        "1": { goodreadsId: 11, method: "source" },
        "2": { goodreadsId: 22, method: "isbn" },
        "3": { goodreadsId: 33, method: "title" },
      },
      {
        details: {
          "1": {
            isbn13: "9781529052015",
            isbn10: "1529052017",
            providerIds: { goodreads: "63055241", hardcover: "x" },
          },
          // List-only ISBN, no Goodreads id.
          "2": { isbn13: null, providerIds: { goodreads: null } },
          // A Goodreads URL slug.
          "3": {
            isbn10: "0345459407",
            providerIds: { goodreads: "68494.Perdido_Street_Station" },
          },
        },
      },
    );
    await fetchSource("bookorbit", config, {
      request,
      steamId: vi.fn(),
      books,
    });
    expect(hints).toEqual({
      "1": { goodreadsId: 63055241, isbn: "9781529052015" },
      "2": { goodreadsId: null, isbn: "9780000000002" },
      "3": { goodreadsId: 68494, isbn: "0345459407" },
    });
  });

  it("skips repeated books, ignored books quietly, warns about unmatched ones, and stops matching after repeated failures", async () => {
    const failure = new GoodreadsLookupError("down");
    const { request, books } = setup(
      [
        [
          card(1),
          card(2),
          card(3),
          card(4),
          card(5),
          card(6),
          card(7),
          card(7),
          { id: "x", title: "" },
        ],
      ],
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
    expect(data.skipped).toBe(7);
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

  it("checks the key before reading the library", async () => {
    const request = vi.fn(async () => {
      throw new Error("Source request failed (401).");
    });
    await expect(
      fetchSource(
        "bookorbit",
        { ...config, baseUrl: "https://bookorbit.example/api/v1/" },
        {
          request,
          steamId: vi.fn(),
          books: { match: vi.fn(), known: vi.fn() },
        },
      ),
    ).rejects.toThrow("401");
    expect(request).toHaveBeenCalledTimes(1);
    expect(String((request.mock.calls[0] as unknown[])[0])).toBe(
      "https://bookorbit.example/api/v1/auth/me",
    );
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
        { ...base, status: "finished", progressValue: 100 },
        { ...reading, status: "dropped" },
        4,
      ),
    ).toMatchObject({ status: "dropped" });
    const finished = mergeImportedItem(
      {
        ...base,
        status: "finished",
        progressValue: 100,
        completions: ["2026-11-01"],
      },
      reading,
      5,
    )!;
    expect(finished).toMatchObject({
      status: "finished",
      progressValue: 100,
      completions: ["2026-11-01"],
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
  it("adds reread finishes to existing completion dates", () => {
    const first = mergeImportedItem(
      { ...base, status: "finished", completions: ["2025-01-01"] },
      null,
      1,
    )!;
    expect(
      mergeImportedItem(
        {
          ...base,
          status: "finished",
          completions: ["2026-11-01", "2025-01-01"],
        },
        first,
        2,
      )?.completions,
    ).toEqual(["2025-01-01", "2026-11-01"]);
  });
});

describe("BookOrbit connection settings and links", () => {
  it("saves a URL and API key, accepting pasted API URLs and headers", async () => {
    const db = await database();
    const service = new ImportService(db, vi.fn());
    const saved = () =>
      db
        .selectFrom("import_connections")
        .select(["base_url", "api_key", "account", "access_token"])
        .executeTakeFirstOrThrow();
    await service.save("bookorbit", {
      enabled: false,
      schedule: "",
      account: "",
      baseUrl: "https://bookorbit.example/api/v1/",
      apiKey: `Bearer ${FAKE_KEY}`,
      accessToken: "old-bearer",
    });
    expect(await saved()).toEqual({
      base_url: "https://bookorbit.example",
      api_key: FAKE_KEY,
      account: "",
      access_token: "",
    });
    await db
      .updateTable("import_connections")
      .set({ account: "reader" })
      .execute();
    // Unchanged server and key keep the account the last import reported.
    await service.save("bookorbit", {
      enabled: true,
      schedule: "0 3 * * *",
      account: "",
      baseUrl: "https://bookorbit.example/api/docs",
    });
    expect(await saved()).toMatchObject({
      base_url: "https://bookorbit.example",
      account: "reader",
    });
    await service.save("bookorbit", {
      enabled: false,
      schedule: "",
      account: "reader",
      baseUrl: "https://other.example",
    });
    expect(await saved()).toMatchObject({ account: "" });
    await service.disconnect("bookorbit");
    await expect(
      service.save("bookorbit", {
        enabled: false,
        schedule: "",
        account: "",
        baseUrl: "https://bookorbit.example",
      }),
    ).rejects.toThrow("API key");
  });

  it("records the account an import reports", async () => {
    const db = await database();
    const service = new ImportService(db, async () => ({
      items: [],
      skipped: 0,
      warnings: [],
      account: "reader",
    }));
    await service.save("bookorbit", {
      enabled: false,
      schedule: "",
      account: "",
      baseUrl: "https://bookorbit.example",
      apiKey: FAKE_KEY,
    });
    await service.run("bookorbit");
    expect(
      (await service.list()).find((row) => row.source === "bookorbit"),
    ).toMatchObject({ account: "reader", lastError: null });
  });

  it("pauses a KOReader-credential connection and retries unmatched books when migrating", async () => {
    const db = await database(22);
    await db
      .insertInto("import_connections")
      .values({
        source: "bookorbit",
        enabled: 1,
        schedule: "0 3 * * *",
        account: "reader",
        base_url: "https://bookorbit.example",
        api_key: "0123456789abcdef0123456789abcdef",
        access_token: "",
        running: 0,
        last_slot: null,
        last_run_at: null,
        last_error: null,
        last_result: null,
      })
      .execute();
    const link = (
      external_id: string,
      method: string,
      goodreads_id: number | null,
    ) => ({
      source: "bookorbit",
      external_id,
      title: "T",
      authors: "[]",
      goodreads_id,
      method,
      checked_at: 5,
    });
    await db
      .insertInto("import_book_links")
      .values([
        link("1", "none", null),
        link("2", "title", 9),
        link("3", "manual", 8),
      ])
      .execute();
    await runMigrations(db);
    const service = new ImportService(db, vi.fn());
    expect(
      (await service.list()).find((row) => row.source === "bookorbit"),
    ).toMatchObject({
      enabled: false,
      schedule: "",
      account: "",
      hasApiKey: false,
      lastError: expect.stringContaining("API key"),
    });
    expect(
      await db
        .selectFrom("import_book_links")
        .select(["external_id", "method", "goodreads_id", "checked_at"])
        .orderBy("external_id")
        .execute(),
    ).toEqual([
      { external_id: "1", method: "none", goodreads_id: null, checked_at: 0 },
      { external_id: "2", method: "title", goodreads_id: 9, checked_at: 5 },
      { external_id: "3", method: "manual", goodreads_id: 8, checked_at: 5 },
    ]);
  });

  it("lists, links, ignores and resets matches over HTTP; disconnect forgets them", async () => {
    const db = await database();
    const service = new ImportService(db, vi.fn());
    await new GoodreadsBookMatcher(db, "bookorbit", async () => []).match(
      hobbit,
      noHints,
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
      noHints,
    );
    await service.disconnect("bookorbit");
    expect(await service.listBookLinks("bookorbit")).toEqual([]);
  });
});
