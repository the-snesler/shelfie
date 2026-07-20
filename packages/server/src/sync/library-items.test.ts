import { beforeAll, describe, expect, it } from "vitest";
import type { ReplicatedLibraryItem } from "@shelfie/shared";
import type * as LibraryItemsSyncModule from "./library-items.js";

// `db/index.ts` builds the Kysely singleton at import time from
// DATABASE_URL, and static ESM imports hoist above this assignment — so
// everything that transitively pulls in `db/index.js` (including the sync
// module under test) must be imported dynamically, after this line runs.
// (type-only imports above are erased at compile time and have no runtime
// side effects, so they don't trigger the early `db/index.js` load.)
process.env.DATABASE_URL = "sqlite://:memory:";

let sync: typeof LibraryItemsSyncModule;

beforeAll(async () => {
  const dbModule = await import("../db/index.js");
  await dbModule.initDb();
  sync = await import("./library-items.js");
});

const base: ReplicatedLibraryItem = {
  id: "tv:1396",
  mediaType: "tv",
  sourceId: "1396",
  status: "active",
  progressFormat: "percent",
  progressValue: null,
  addedAt: 1,
  updatedAt: 10,
  platforms: [],
  rating: null,
  completedDates: [],
  notes: "",
  watchedEpisodes: [],
  _deleted: false,
};

describe("libraryItemsSync", () => {
  it("inserts a new document and reads it back unchanged", async () => {
    await sync.libraryItemsSync.upsert(base, 1);

    const found = await sync.libraryItemsSync.fetchById("tv:1396");

    expect(found).toEqual(base);
  });

  it("persists watchedEpisodes on the UPDATE path (regression: doUpdateSet once omitted watched_episodes)", async () => {
    const withEpisodes: ReplicatedLibraryItem = {
      ...base,
      watchedEpisodes: ["s1e1", "s1e2"],
      updatedAt: base.updatedAt + 1,
    };

    await sync.libraryItemsSync.upsert(withEpisodes, 2);

    const found = await sync.libraryItemsSync.fetchById("tv:1396");

    expect(found?.watchedEpisodes).toEqual(["s1e1", "s1e2"]);
  });

  it("persists every mutable field on update, including a soft delete", async () => {
    const updated: ReplicatedLibraryItem = {
      ...base,
      status: "completed",
      rating: 4.5,
      notes: "rewatched season 1",
      progressValue: 50,
      completedDates: ["2024-01-02"],
      platforms: ["Netflix"],
      watchedEpisodes: ["s1e1", "s1e2"],
      updatedAt: base.updatedAt + 2,
      _deleted: true,
    };

    await sync.libraryItemsSync.upsert(updated, 3);

    const found = await sync.libraryItemsSync.fetchById("tv:1396");

    expect(found).toEqual(updated);
  });

  it("fetchSince replaces rather than appends, and excludes rows at/before the cursor", async () => {
    const sinceStart = await sync.libraryItemsSync.fetchSince(0, 10);
    const matching = sinceStart.filter((entry) => entry.doc.id === "tv:1396");

    expect(matching).toHaveLength(1);
    expect(matching[0]?.seq).toBe(3);

    const sinceLatest = await sync.libraryItemsSync.fetchSince(3, 10);

    expect(sinceLatest).toEqual([]);
  });
});
