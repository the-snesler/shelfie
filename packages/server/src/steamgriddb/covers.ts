import type { CoverShape } from "@shelfie/shared";
import type { Kysely } from "kysely";
import type { Database } from "../db/types.js";
import { findSteamAppIdByGameId } from "../igdb/client.js";
import {
  fetchSgdbGameBySteamAppId,
  fetchTopSgdbGrid,
  isSteamGridDbConfigured,
  searchSgdbGames,
  type SgdbGrid,
} from "./client.js";
import {
  pickUniqueTitleMatch,
  pickYearMatch,
  SHAPE_FALLBACKS,
} from "./match.js";

/** Same freshness window as the metadata caches; misses are cached too. */
export const COVER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CoverSources {
  configured: () => boolean;
  searchGames: typeof searchSgdbGames;
  gameBySteamAppId: typeof fetchSgdbGameBySteamAppId;
  topGrid: typeof fetchTopSgdbGrid;
  steamAppId: typeof findSteamAppIdByGameId;
  now: () => number;
}

const defaultSources: CoverSources = {
  configured: isSteamGridDbConfigured,
  searchGames: searchSgdbGames,
  gameBySteamAppId: fetchSgdbGameBySteamAppId,
  topGrid: fetchTopSgdbGrid,
  steamAppId: findSteamAppIdByGameId,
  now: Date.now,
};

export type CoverResolver = (
  igdbId: number,
  shape: CoverShape,
) => Promise<SgdbGrid | null>;

/**
 * Resolves the SteamGridDB grid for an IGDB game in a shape bucket (walking
 * {@link SHAPE_FALLBACKS}), or null when the caller should use IGDB's cover.
 * Only games already in `game_metadata` resolve — the title and release year
 * drive matching, and it keeps this public image route from triggering
 * upstream lookups for arbitrary ids. Hits and misses are both cached for
 * {@link COVER_TTL_MS}; upstream errors throw and cache nothing. Concurrent
 * requests for the same key share one resolution.
 */
export function createCoverResolver(
  database: Kysely<Database>,
  sources: CoverSources = defaultSources,
): CoverResolver {
  const inflight = new Map<string, Promise<unknown>>();

  function once<T>(key: string, work: () => Promise<T>): Promise<T> {
    const pending = inflight.get(key) as Promise<T> | undefined;
    if (pending) return pending;
    const promise = work().finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  }

  const isFresh = (fetchedAt: number) =>
    fetchedAt >= sources.now() - COVER_TTL_MS;

  async function matchGame(
    igdbId: number,
    game: { name: string; first_release_date: number | null },
  ): Promise<number | null> {
    const candidates = await sources.searchGames(game.name);
    const byYear = pickYearMatch(
      candidates,
      game.name,
      game.first_release_date,
    );
    if (byYear !== null) return byYear;

    const appId = await sources.steamAppId(igdbId);
    if (appId !== null) {
      const bySteam = await sources.gameBySteamAppId(appId);
      if (bySteam) return bySteam.id;
    }
    return pickUniqueTitleMatch(candidates, game.name);
  }

  function sgdbGameId(igdbId: number): Promise<number | null> {
    return once(`game:${igdbId}`, async () => {
      const cached = await database
        .selectFrom("sgdb_games")
        .select(["sgdb_id", "fetched_at"])
        .where("igdb_id", "=", igdbId)
        .executeTakeFirst();
      if (cached && isFresh(cached.fetched_at)) return cached.sgdb_id;

      const game = await database
        .selectFrom("game_metadata")
        .select(["name", "first_release_date"])
        .where("igdb_id", "=", igdbId)
        .executeTakeFirst();
      if (!game) return null; // not cached as a miss: the card may arrive later

      const sgdbId = await matchGame(igdbId, game);
      const row = {
        igdb_id: igdbId,
        sgdb_id: sgdbId,
        fetched_at: sources.now(),
      };
      await database
        .insertInto("sgdb_games")
        .values(row)
        .onConflict((oc) =>
          oc.column("igdb_id").doUpdateSet({
            sgdb_id: row.sgdb_id,
            fetched_at: row.fetched_at,
          }),
        )
        .execute();
      return sgdbId;
    });
  }

  function bucketGrid(
    igdbId: number,
    shape: CoverShape,
  ): Promise<SgdbGrid | null> {
    return once(`grid:${igdbId}:${shape}`, async () => {
      const cached = await database
        .selectFrom("sgdb_grids")
        .select(["url", "thumb_url", "fetched_at"])
        .where("igdb_id", "=", igdbId)
        .where("shape", "=", shape)
        .executeTakeFirst();
      if (cached && isFresh(cached.fetched_at)) {
        return cached.url && cached.thumb_url
          ? { url: cached.url, thumb: cached.thumb_url }
          : null;
      }

      const sgdbId = await sgdbGameId(igdbId);
      if (sgdbId === null) return null; // the game-level miss is cached already

      const grid = await sources.topGrid(sgdbId, shape);
      const row = {
        igdb_id: igdbId,
        shape,
        url: grid?.url ?? null,
        thumb_url: grid?.thumb ?? null,
        fetched_at: sources.now(),
      };
      await database
        .insertInto("sgdb_grids")
        .values(row)
        .onConflict((oc) =>
          oc.columns(["igdb_id", "shape"]).doUpdateSet({
            url: row.url,
            thumb_url: row.thumb_url,
            fetched_at: row.fetched_at,
          }),
        )
        .execute();
      return grid;
    });
  }

  return async (igdbId, shape) => {
    if (!sources.configured()) return null;
    for (const bucket of SHAPE_FALLBACKS[shape]) {
      const grid = await bucketGrid(igdbId, bucket);
      if (grid) return grid;
    }
    return null;
  };
}
