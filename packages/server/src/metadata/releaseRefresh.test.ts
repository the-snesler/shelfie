import type { ItemStatus, MediaType } from "@shelfie/shared";
import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../db/migrations.js";
import type { Database } from "../db/types.js";
import { libraryItemDocToRow } from "../sync/row.js";
import type { CachedCard, MetadataCollection } from "./collection.js";
import {
  MAX_REFRESH_PER_MEDIUM,
  runReleaseRefreshCycle,
  watchMedium,
} from "./releaseRefresh.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-11-06T12:00:00Z");

interface FakeCard {
  id: number;
  day: string | null;
}

function fakeCollection(
  cached: Map<number, CachedCard<FakeCard>>,
  fetch: (ids: number[]) => Promise<FakeCard[]>,
): MetadataCollection<FakeCard, FakeCard> {
  return {
    basePath: "/api/fake",
    search: async () => [],
    cardId: (card) => card.id,
    releaseDays: (card) => (card.day ? [card.day] : []),
    fetchCachedCards: async (_db, ids) =>
      new Map([...cached].filter(([id]) => ids.includes(id))),
    fetchMissingCards: async (_db, ids) => fetch(ids),
    detail: {
      path: "by-id/:id",
      param: "id",
      parseKey: Number,
      fetchCached: async () => null,
      fetchFromSource: async () => null,
      upsert: async () => undefined,
    },
  };
}

let database: Kysely<Database>;

beforeEach(async () => {
  database = new Kysely<Database>({
    dialect: new SqliteDialect({ database: new BetterSqlite3(":memory:") }),
  });
  await runMigrations(database);
});

afterEach(async () => {
  await database.destroy();
});

async function own(
  mediaType: MediaType,
  sourceId: number,
  status: ItemStatus = "wishlisted",
  deleted = false,
) {
  await database
    .insertInto("library_items")
    .values(
      libraryItemDocToRow(
        {
          id: `${mediaType}:${sourceId}`,
          mediaType,
          sourceId: String(sourceId),
          status,
          platforms: [],
          progressFormat: "percent",
          progressValue: null,
          rating: null,
          excitement: null,
          notes: "",
          completedDates: [],
          watchedEpisodes: {},
          activity: [],
          addedAt: 1,
          updatedAt: 1,
          _deleted: deleted,
        },
        sourceId,
      ),
    )
    .execute();
}

describe("release refresh cycle", () => {
  it("refreshes stale planned cards near release, missing, or dateless", async () => {
    const stale = now - 8 * DAY_MS;
    const cached = new Map<number, CachedCard<FakeCard>>([
      [1, { card: { id: 1, day: "2026-12-01" }, fetchedAt: stale }],
      [2, { card: { id: 2, day: "2010-01-01" }, fetchedAt: stale }],
      [3, { card: { id: 3, day: null }, fetchedAt: stale }],
      [4, { card: { id: 4, day: "2026-12-01" }, fetchedAt: now - 1000 }],
      [6, { card: { id: 6, day: "2026-12-01" }, fetchedAt: stale }],
      [7, { card: { id: 7, day: "2026-12-01" }, fetchedAt: stale }],
    ]);
    const fetch = vi.fn(async (ids: number[]) =>
      ids.map((id) => ({ id, day: null })),
    );
    for (const id of [1, 2, 3, 4, 5]) await own("movie", id);
    await own("movie", 6, "active");
    await own("movie", 7, "wishlisted", true);
    await own("book", 1);

    const failed = await runReleaseRefreshCycle(
      database,
      [watchMedium("movie", fakeCollection(cached, fetch))],
      now,
    );

    expect(failed).toEqual([]);
    expect(fetch).toHaveBeenCalledOnce();
    // Missing (5) first, then stalest; long-released, fresh, active, and
    // deleted items are skipped.
    expect(fetch.mock.calls[0]![0]).toEqual([5, 1, 3]);
  });

  it("bounds a pass and isolates ids that fail upstream", async () => {
    const total = MAX_REFRESH_PER_MEDIUM + 5;
    for (let id = 1; id <= total; id++) await own("book", id);
    const fetch = vi.fn(async (ids: number[]) => {
      if (ids.includes(2)) throw new Error("not found");
      return ids.map((id) => ({ id, day: null }));
    });
    const medium = watchMedium("book", fakeCollection(new Map(), fetch));

    expect(await medium.refresh(database, [1, 2, 3], now)).toBe(2);
    fetch.mockClear();
    await runReleaseRefreshCycle(database, [medium], now);
    expect(fetch.mock.calls[0]![0]).toHaveLength(MAX_REFRESH_PER_MEDIUM);
  });

  it("reports a medium whose upstream is unreachable", async () => {
    await own("game", 1);
    const fetch = vi.fn(async () => {
      throw new Error("IGDB credentials missing");
    });

    expect(
      await runReleaseRefreshCycle(
        database,
        [watchMedium("game", fakeCollection(new Map(), fetch))],
        now,
      ),
    ).toEqual(["game"]);
  });
});
