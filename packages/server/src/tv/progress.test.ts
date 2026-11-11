import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultLogFormat,
  type ReplicatedLibraryItem,
  type TvLastAiring,
  type TvMetadata,
} from "@shelfie/shared";
import { runMigrations } from "../db/migrations.js";
import { initSequence } from "../db/sequence.js";
import type { Database } from "../db/types.js";
import { libraryItemDocToRow, libraryItemRowToDoc } from "../sync/row.js";
import { decideTvStatus, runTvProgressPass } from "./progress.js";

const NOW = Date.parse("2026-11-11T12:00:00Z");
const TODAY = "2026-11-11";

const last = (
  episodeNumber: number,
  episodeType: string | null,
  airDate = "2026-11-01",
): TvLastAiring => ({
  seasonNumber: 1,
  episodeNumber,
  name: "",
  airDate,
  stillPath: null,
  episodeType,
});
const card = (
  lastEpisodeToAir: TvLastAiring | null,
  extra: Partial<TvMetadata> = {},
): TvMetadata => ({
  tmdbId: 7,
  name: "Show",
  posterPath: null,
  genres: [],
  firstAirYear: 2026,
  firstAirDate: "2026-10-01",
  status: "Returning Series",
  numberOfSeasons: 1,
  numberOfEpisodes: 10,
  networks: [],
  createdBy: [],
  summary: null,
  nextEpisodeToAir: null,
  lastEpisodeToAir,
  airedEpisodes: lastEpisodeToAir?.episodeNumber ?? null,
  ...extra,
});
const show = (
  patch: Partial<ReplicatedLibraryItem> = {},
): ReplicatedLibraryItem => ({
  id: "tv:7",
  mediaType: "tv",
  sourceId: "7",
  status: "active",
  progressFormat: defaultLogFormat("tv"),
  progressValue: null,
  platforms: [],
  rating: null,
  excitement: null,
  completedDates: [],
  notes: "",
  watchedEpisodes: { s1e1: "2026-10-20", s1e2: "2026-11-02" },
  activity: [],
  addedAt: 1,
  updatedAt: 1,
  _deleted: false,
  ...patch,
});

describe("decideTvStatus", () => {
  it("finishes an active show at its season's end, dated by the last episode", () => {
    expect(decideTvStatus(show(), card(last(2, "finale")), TODAY)).toEqual({
      state: "season-over",
      stateKey: "season-over@s1e2",
      patch: { status: "finished", completedDates: ["2026-11-02"] },
    });
  });
  it("reopens a show marked Watched while still airing", () => {
    expect(
      decideTvStatus(
        show({ status: "finished" }),
        card(last(2, "standard"), {
          nextEpisodeToAir: { ...last(3, null), airDate: "2026-11-15" },
        }),
        TODAY,
      )?.patch?.status,
    ).toBe("active");
  });
  it("reopens a finished show only for episodes aired after the watcher's last activity", () => {
    const finished = show({
      status: "finished",
      completedDates: ["2026-11-03"],
    });
    expect(
      decideTvStatus(finished, card(last(3, "standard", "2026-11-09")), TODAY)
        ?.patch?.status,
    ).toBe("active");
    // Marked Watched after the latest airing without ticking it off.
    expect(
      decideTvStatus(finished, card(last(3, "finale", "2026-11-02")), TODAY)
        ?.patch,
    ).toBeNull();
    // Show-level tracking with no known day: leave it.
    expect(
      decideTvStatus(
        show({ status: "finished", watchedEpisodes: {} }),
        card(last(3, "finale")),
        TODAY,
      )?.patch,
    ).toBeNull();
  });
  it("is undecided without episode data", () => {
    expect(decideTvStatus(show(), card(null), TODAY)).toBeNull();
  });
});

describe("runTvProgressPass", () => {
  const databases: Kysely<Database>[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const db of databases.splice(0)) await db.destroy();
  });

  async function setup(cardValue: TvMetadata, item = show()) {
    const db = new Kysely<Database>({
      dialect: new SqliteDialect({ database: new BetterSqlite3(":memory:") }),
    });
    databases.push(db);
    await runMigrations(db);
    initSequence("library_items", 0);
    await db
      .insertInto("library_items")
      .values(libraryItemDocToRow(item, 1))
      .execute();
    // A fresh cached card, so the pass never calls TMDB.
    await db
      .insertInto("tv_metadata")
      .values({
        tmdb_id: cardValue.tmdbId,
        name: cardValue.name,
        poster_path: null,
        genres: "[]",
        first_air_year: cardValue.firstAirYear,
        first_air_date: cardValue.firstAirDate,
        status: cardValue.status,
        number_of_seasons: cardValue.numberOfSeasons,
        number_of_episodes: cardValue.numberOfEpisodes,
        networks: "[]",
        created_by: "[]",
        summary: null,
        next_episode: cardValue.nextEpisodeToAir
          ? JSON.stringify(cardValue.nextEpisodeToAir)
          : null,
        last_episode: cardValue.lastEpisodeToAir
          ? JSON.stringify(cardValue.lastEpisodeToAir)
          : null,
        aired_episodes: cardValue.airedEpisodes,
        backdrop_path: null,
        tagline: null,
        certification: null,
        vote_average: null,
        vote_count: null,
        videos: null,
        cast_members: null,
        seasons: null,
        last_air_date: null,
        in_production: null,
        imdb_id: null,
        fetched_at: NOW,
        detail_fetched_at: null,
      })
      .execute();
    vi.spyOn(console, "info").mockImplementation(() => {});
    const current = async () =>
      libraryItemRowToDoc(
        await db
          .selectFrom("library_items")
          .selectAll()
          .executeTakeFirstOrThrow(),
      );
    return { db, current };
  }

  it("finishes once, then leaves a manual reopen alone until the show moves on", async () => {
    const { db, current } = await setup(card(last(2, "finale")));
    expect(await runTvProgressPass(db, { now: NOW })).toEqual([
      {
        id: "tv:7",
        name: "Show",
        from: "active",
        to: "finished",
        state: "season-over",
      },
    ]);
    expect(await current()).toMatchObject({
      status: "finished",
      completedDates: ["2026-11-02"],
    });
    // The user reopens it (say, to rewatch): same state, so no fight.
    await db.updateTable("library_items").set({ status: "active" }).execute();
    expect(await runTvProgressPass(db, { now: NOW + 3_600_000 })).toEqual([]);
    expect((await current()).status).toBe("active");
  });

  it("reopens a finished show when a new episode airs", async () => {
    const { db, current } = await setup(
      card(last(2, "finale")),
      show({
        status: "finished",
        completedDates: ["2026-11-02"],
      }),
    );
    expect(await runTvProgressPass(db, { now: NOW })).toEqual([]);
    await db
      .updateTable("tv_metadata")
      .set({
        last_episode: JSON.stringify(last(3, "standard", "2026-11-10")),
        aired_episodes: 3,
      })
      .execute();
    const changes = await runTvProgressPass(db, { now: NOW });
    expect(changes.map((c) => [c.from, c.to, c.state])).toEqual([
      ["finished", "active", "behind"],
    ]);
    expect(await current()).toMatchObject({
      status: "active",
      completedDates: ["2026-11-02"],
    });
  });

  it("skips paused shows and ids outside the requested batch", async () => {
    const { db } = await setup(
      card(last(2, "finale")),
      show({ status: "paused" }),
    );
    expect(await runTvProgressPass(db, { now: NOW })).toEqual([]);
    await db.updateTable("library_items").set({ status: "active" }).execute();
    expect(
      await runTvProgressPass(db, { now: NOW, itemIds: ["tv:8"] }),
    ).toEqual([]);
    expect(await runTvProgressPass(db, { now: NOW, itemIds: [] })).toEqual([]);
  });
});
