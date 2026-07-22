import type {
  GameDetail,
  GameMetadata,
  PlatformRelease,
  TimeToBeat,
} from "@shelfie/shared";
import type { Hono } from "hono";
import type { Kysely } from "kysely";
import { db as defaultDb } from "../db/index.js";
import type { Database, GameMetadataTable } from "../db/types.js";
import {
  fetchTimeToBeatsByIds,
  fetchGameDetailBySlug,
  fetchGamesByIds,
  searchGames,
} from "../igdb/client.js";
import type { CachedCard, MetadataCollection } from "../metadata/collection.js";
import { registerMetadataRoutes } from "../metadata/routes.js";

function metadataRowToDto(
  row: GameMetadataTable & { slug: string },
): GameMetadata {
  return {
    igdbId: row.igdb_id,
    slug: row.slug,
    name: row.name,
    coverImageId: row.cover_image_id,
    summary: row.summary,
    genres: JSON.parse(row.genres) as string[],
    platforms: JSON.parse(row.platforms) as string[],
    platformReleaseDates: JSON.parse(
      row.platform_release_dates,
    ) as PlatformRelease[],
    developer: row.developer,
    firstReleaseDate: row.first_release_date,
    timeToBeat: row.time_to_beat
      ? (JSON.parse(row.time_to_beat) as TimeToBeat)
      : null,
  };
}

function metadataToRow(metadata: GameMetadata): GameMetadataTable {
  return {
    igdb_id: metadata.igdbId,
    slug: metadata.slug,
    name: metadata.name,
    cover_image_id: metadata.coverImageId,
    summary: metadata.summary,
    genres: JSON.stringify(metadata.genres),
    platforms: JSON.stringify(metadata.platforms),
    platform_release_dates: JSON.stringify(metadata.platformReleaseDates),
    developer: metadata.developer,
    first_release_date: metadata.firstReleaseDate,
    fetched_at: Date.now(),
    storyline: null,
    screenshots: null,
    videos: null,
    game_modes: null,
    themes: null,
    player_perspectives: null,
    publisher: null,
    aggregated_rating: null,
    aggregated_rating_count: null,
    rating: null,
    rating_count: null,
    stores: null,
    time_to_beat: metadata.timeToBeat
      ? JSON.stringify(metadata.timeToBeat)
      : null,
    detail_fetched_at: null,
  };
}

function metadataRowToDetail(
  row: GameMetadataTable & { slug: string },
): GameDetail {
  return {
    ...metadataRowToDto(row),
    storyline: row.storyline,
    screenshotImageIds: JSON.parse(row.screenshots ?? "[]") as string[],
    videos: JSON.parse(row.videos ?? "[]") as GameDetail["videos"],
    gameModes: JSON.parse(row.game_modes ?? "[]") as string[],
    themes: JSON.parse(row.themes ?? "[]") as string[],
    playerPerspectives: JSON.parse(row.player_perspectives ?? "[]") as string[],
    publisher: row.publisher,
    aggregatedRating: row.aggregated_rating,
    aggregatedRatingCount: row.aggregated_rating_count ?? 0,
    rating: row.rating,
    ratingCount: row.rating_count ?? 0,
    stores: JSON.parse(row.stores ?? "[]") as GameDetail["stores"],
    timeToBeat: row.time_to_beat
      ? (JSON.parse(row.time_to_beat) as GameDetail["timeToBeat"])
      : null,
  };
}

function detailToRow(detail: GameDetail): GameMetadataTable {
  return {
    ...metadataToRow(detail),
    storyline: detail.storyline,
    screenshots: JSON.stringify(detail.screenshotImageIds),
    videos: JSON.stringify(detail.videos),
    game_modes: JSON.stringify(detail.gameModes),
    themes: JSON.stringify(detail.themes),
    player_perspectives: JSON.stringify(detail.playerPerspectives),
    publisher: detail.publisher,
    aggregated_rating: detail.aggregatedRating,
    aggregated_rating_count: detail.aggregatedRatingCount,
    rating: detail.rating,
    rating_count: detail.ratingCount,
    stores: JSON.stringify(detail.stores),
    time_to_beat: detail.timeToBeat ? JSON.stringify(detail.timeToBeat) : null,
    detail_fetched_at: Date.now(),
  };
}

/** Upserts a fetched game's row into the cache, keyed by igdb_id. */
async function upsertMetadata(
  database: Kysely<Database>,
  metadata: GameMetadata,
): Promise<GameMetadataTable> {
  const row = metadataToRow(metadata);
  await database
    .insertInto("game_metadata")
    .values(row)
    .onConflict((oc) =>
      oc.column("igdb_id").doUpdateSet({
        slug: row.slug,
        name: row.name,
        cover_image_id: row.cover_image_id,
        summary: row.summary,
        genres: row.genres,
        platforms: row.platforms,
        platform_release_dates: row.platform_release_dates,
        developer: row.developer,
        first_release_date: row.first_release_date,
        fetched_at: row.fetched_at,
        time_to_beat: (eb) =>
          eb.fn.coalesce(
            eb.ref("excluded.time_to_beat"),
            eb.ref("game_metadata.time_to_beat"),
          ),
      }),
    )
    .execute();
  return row;
}

/** Upserts a fetched game's detail row into the cache, keyed by igdb_id. */
async function upsertDetail(
  database: Kysely<Database>,
  detail: GameDetail,
): Promise<GameMetadataTable> {
  const row = detailToRow(detail);
  await database
    .insertInto("game_metadata")
    .values(row)
    .onConflict((oc) =>
      oc.column("igdb_id").doUpdateSet({
        slug: row.slug,
        name: row.name,
        cover_image_id: row.cover_image_id,
        summary: row.summary,
        genres: row.genres,
        platforms: row.platforms,
        platform_release_dates: row.platform_release_dates,
        developer: row.developer,
        first_release_date: row.first_release_date,
        fetched_at: row.fetched_at,
        storyline: row.storyline,
        screenshots: row.screenshots,
        videos: row.videos,
        game_modes: row.game_modes,
        themes: row.themes,
        player_perspectives: row.player_perspectives,
        publisher: row.publisher,
        aggregated_rating: row.aggregated_rating,
        aggregated_rating_count: row.aggregated_rating_count,
        rating: row.rating,
        rating_count: row.rating_count,
        stores: row.stores,
        time_to_beat: row.time_to_beat,
        detail_fetched_at: row.detail_fetched_at,
      }),
    )
    .execute();
  return row;
}

/**
 * Wires the games API into the shared cache-first route registrar. Rows
 * cached before migration 002 have a NULL slug — `fetchCachedCards` and the
 * by-slug detail lookup both treat those legacy rows as absent so every
 * response consistently carries a slug.
 */
const gamesMetadataCollection: MetadataCollection<
  GameMetadata,
  GameDetail,
  string
> = {
  basePath: "/api/games",

  search: searchGames,

  cardId: (card) => card.igdbId,

  async fetchCachedCards(database, ids) {
    const cached = await database
      .selectFrom("game_metadata")
      .selectAll()
      .where("igdb_id", "in", ids)
      .execute();

    const result = new Map<number, CachedCard<GameMetadata>>();
    for (const row of cached) {
      if (row.slug === null) continue;
      result.set(row.igdb_id, {
        card: metadataRowToDto(row as GameMetadataTable & { slug: string }),
        fetchedAt: row.fetched_at,
      });
    }
    return result;
  },

  async fetchMissingCards(database, missingIds) {
    const [fetched, ttbs] = await Promise.all([
      fetchGamesByIds(missingIds),
      fetchTimeToBeatsByIds(missingIds),
    ]);

    const cards: GameMetadata[] = [];
    for (const metadata of fetched) {
      metadata.timeToBeat = ttbs.get(metadata.igdbId) ?? null;
      const row = await upsertMetadata(database, metadata);
      cards.push(metadataRowToDto(row as GameMetadataTable & { slug: string }));
    }
    return cards;
  },

  detail: {
    path: "by-slug/:slug",
    param: "slug",

    parseKey: (raw) => raw,

    async fetchCached(database, slug) {
      const cached = await database
        .selectFrom("game_metadata")
        .selectAll()
        .where("slug", "=", slug)
        .executeTakeFirst();
      if (!cached || cached.slug === null) return null;
      return {
        detail: metadataRowToDetail(
          cached as GameMetadataTable & { slug: string },
        ),
        detailFetchedAt: cached.detail_fetched_at,
      };
    },

    fetchFromSource: (slug) => fetchGameDetailBySlug(slug),

    upsert: (database, detail) => upsertDetail(database, detail),
  },
};

export function registerGamesRoutes(
  app: Hono,
  database: Kysely<Database> = defaultDb,
): void {
  registerMetadataRoutes(app, database, gamesMetadataCollection);
}
