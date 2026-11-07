import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../db/migrations.js";
import type { Database } from "../db/types.js";
import type { SgdbGame, SgdbGrid } from "./client.js";
import {
  COVER_TTL_MS,
  createCoverResolver,
  type CoverSources,
} from "./covers.js";
import {
  normalizeTitle,
  pickUniqueTitleMatch,
  pickYearMatch,
} from "./match.js";

const year = (y: number) => Date.UTC(y, 5, 1) / 1000;

describe("title matching", () => {
  it("normalizes case, diacritics, punctuation and ampersands", () => {
    expect(normalizeTitle("Pokémon: X & Y™")).toBe("pokemon x and y");
    expect(normalizeTitle("Assassin's Creed Unity")).toBe(
      normalizeTitle("Assassin’s Creed: Unity"),
    );
    expect(normalizeTitle("Assassins Creed")).toBe("assassins creed");
    expect(normalizeTitle("Assassin's Creed")).toBe("assassins creed");
  });

  const candidates: SgdbGame[] = [
    { id: 1, name: "God of War", release_date: year(2005) },
    { id: 2, name: "God of War", release_date: year(2018) },
    { id: 3, name: "God of War Ragnarök", release_date: year(2022) },
  ];

  it("disambiguates same-titled games by release year (±1)", () => {
    expect(pickYearMatch(candidates, "God of War", year(2018))).toBe(2);
    expect(pickYearMatch(candidates, "God of War", year(2006))).toBe(1);
    expect(pickYearMatch(candidates, "God of War Ragnarok", year(2022))).toBe(
      3,
    );
  });

  it("rejects exact titles more than a year off", () => {
    expect(pickYearMatch(candidates, "God of War", year(2012))).toBeNull();
  });

  it("accepts an unknown year on either side", () => {
    expect(
      pickYearMatch([{ id: 9, name: "Bloodborne" }], "Bloodborne", year(2015)),
    ).toBe(9);
    expect(pickYearMatch(candidates, "God of War", null)).toBe(1);
  });

  it("only falls back to a title match when it is unambiguous", () => {
    expect(pickUniqueTitleMatch(candidates, "God of War")).toBeNull();
    expect(pickUniqueTitleMatch(candidates, "God of War Ragnarök")).toBe(3);
    expect(pickUniqueTitleMatch(candidates, "Halo")).toBeNull();
  });
});

describe("createCoverResolver", () => {
  let database: Kysely<Database>;
  let now: number;
  let sources: CoverSources;
  const grid = (tag: string): SgdbGrid => ({
    url: `https://cdn2.steamgriddb.com/grid/${tag}.png`,
    thumb: `https://cdn2.steamgriddb.com/thumb/${tag}.jpg`,
  });

  beforeEach(async () => {
    database = new Kysely<Database>({
      dialect: new SqliteDialect({ database: new BetterSqlite3(":memory:") }),
    });
    await runMigrations(database);
    await database
      .insertInto("game_metadata")
      .values({
        igdb_id: 100,
        slug: "horizon-zero-dawn",
        name: "Horizon Zero Dawn",
        cover_image_id: "co1",
        summary: null,
        genres: "[]",
        platforms: "[]",
        platform_release_dates: "[]",
        developer: null,
        first_release_date: year(2017),
        fetched_at: 0,
      })
      .execute();
    now = 1_000_000;
    sources = {
      configured: () => true,
      searchGames: vi.fn(async () => [
        { id: 7, name: "Horizon Zero Dawn", release_date: year(2017) },
      ]),
      gameBySteamAppId: vi.fn(async () => null),
      topGrid: vi.fn(async (_id, shape) =>
        shape === "square" ? null : grid(shape),
      ),
      steamAppId: vi.fn(async () => null),
      now: () => now,
    };
  });

  afterEach(async () => {
    await database.destroy();
  });

  it("returns the bucket's top grid and caches hits and misses", async () => {
    const resolve = createCoverResolver(database, sources);
    expect(await resolve(100, "tall")).toEqual(grid("tall"));
    expect(await resolve(100, "square")).toBeNull();
    expect(await resolve(100, "tall")).toEqual(grid("tall"));
    expect(await resolve(100, "square")).toBeNull();
    expect(sources.searchGames).toHaveBeenCalledTimes(1);
    expect(sources.topGrid).toHaveBeenCalledTimes(2);
  });

  it("walks iso ↔ tall fallbacks but never square", async () => {
    sources.topGrid = vi.fn(async (_id, shape) =>
      shape === "tall" ? grid("tall") : null,
    );
    const resolve = createCoverResolver(database, sources);
    expect(await resolve(100, "iso")).toEqual(grid("tall"));
    expect(sources.topGrid).toHaveBeenCalledWith(7, "iso");
    expect(sources.topGrid).toHaveBeenCalledWith(7, "tall");

    sources.topGrid = vi.fn(async (_id, shape) =>
      shape === "square" ? null : grid(shape),
    );
    expect(
      await createCoverResolver(database, sources)(100, "square"),
    ).toBeNull();
  });

  it("refetches once the cache entry is stale", async () => {
    const resolve = createCoverResolver(database, sources);
    await resolve(100, "tall");
    now += COVER_TTL_MS + 1;
    await resolve(100, "tall");
    expect(sources.searchGames).toHaveBeenCalledTimes(2);
    expect(sources.topGrid).toHaveBeenCalledTimes(2);
  });

  it("falls back to the Steam app id when the year doesn't match", async () => {
    sources.searchGames = vi.fn(async () => [
      { id: 7, name: "Horizon Zero Dawn", release_date: year(2020) },
      { id: 8, name: "Horizon Zero Dawn", release_date: year(2024) },
    ]);
    sources.steamAppId = vi.fn(async () => 1151640);
    sources.gameBySteamAppId = vi.fn(async () => ({
      id: 8,
      name: "Horizon Zero Dawn Remastered",
    }));
    const resolve = createCoverResolver(database, sources);
    await resolve(100, "tall");
    expect(sources.gameBySteamAppId).toHaveBeenCalledWith(1151640);
    expect(sources.topGrid).toHaveBeenCalledWith(8, "tall");
  });

  it("skips lookups for games outside the catalog and without a key", async () => {
    const resolve = createCoverResolver(database, sources);
    expect(await resolve(999, "tall")).toBeNull();
    expect(sources.searchGames).not.toHaveBeenCalled();
    expect(
      await database.selectFrom("sgdb_games").selectAll().execute(),
    ).toEqual([]);

    sources.configured = () => false;
    expect(await resolve(100, "tall")).toBeNull();
    expect(sources.searchGames).not.toHaveBeenCalled();
  });

  it("caches nothing when upstream fails", async () => {
    sources.topGrid = vi.fn(async () => {
      throw new Error("SteamGridDB request failed (502)");
    });
    const resolve = createCoverResolver(database, sources);
    await expect(resolve(100, "tall")).rejects.toThrow("502");
    expect(
      await database.selectFrom("sgdb_grids").selectAll().execute(),
    ).toEqual([]);
  });

  it("shares one lookup between concurrent requests", async () => {
    const resolve = createCoverResolver(database, sources);
    await Promise.all([resolve(100, "tall"), resolve(100, "tall")]);
    expect(sources.searchGames).toHaveBeenCalledTimes(1);
    expect(sources.topGrid).toHaveBeenCalledTimes(1);
  });
});
