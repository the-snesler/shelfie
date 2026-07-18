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

const METADATA_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

function parseIds(raw: string): number[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => Number(part))
    .filter((id) => Number.isInteger(id));
}

export function registerGamesRoutes(
  app: Hono,
  database: Kysely<Database> = defaultDb,
): void {
  app.get("/api/games/search", async (c) => {
    const q = c.req.query("q");
    if (!q || q.trim().length === 0) {
      return c.json({ error: "q is required" }, 400);
    }
    const results = await searchGames(q);
    return c.json(results);
  });

  app.get("/api/games", async (c) => {
    const idsParam = c.req.query("ids");
    const ids = idsParam ? parseIds(idsParam) : [];
    if (ids.length === 0) return c.json<GameMetadata[]>([]);

    const cached = await database
      .selectFrom("game_metadata")
      .selectAll()
      .where("igdb_id", "in", ids)
      .execute();
    // Rows cached before migration 002 have a NULL slug; treat them as
    // misses so every response consistently carries a slug.
    const cachedById = new Map(
      cached
        .filter(
          (row): row is GameMetadataTable & { slug: string } =>
            row.slug !== null,
        )
        .map((row) => [row.igdb_id, row]),
    );

    const missingIds = ids.filter((id) => {
      const row = cachedById.get(id);
      return !row || row.fetched_at < Date.now() - METADATA_TTL_MS;
    });
    if (missingIds.length > 0) {
      const [fetched, ttbs] = await Promise.all([
        fetchGamesByIds(missingIds),
        fetchTimeToBeatsByIds(missingIds),
      ]);
      
      for (const metadata of fetched) {
        metadata.timeToBeat = ttbs.get(metadata.igdbId) ?? null;
        const row = await upsertMetadata(database, metadata);
        cachedById.set(
          metadata.igdbId,
          row as GameMetadataTable & { slug: string },
        );
      }
    }

    const results: GameMetadata[] = [];
    for (const id of ids) {
      const row = cachedById.get(id);
      if (row) results.push(metadataRowToDto(row));
    }
    return c.json(results);
  });

  app.get("/api/games/by-slug/:slug", async (c) => {
    const slug = c.req.param("slug");

    const cached = await database
      .selectFrom("game_metadata")
      .selectAll()
      .where("slug", "=", slug)
      .executeTakeFirst();
    if (
      cached &&
      cached.slug !== null &&
      cached.detail_fetched_at !== null &&
      cached.detail_fetched_at >= Date.now() - METADATA_TTL_MS
    ) {
      return c.json(
        metadataRowToDetail(cached as GameMetadataTable & { slug: string }),
      );
    }

    const detail = await fetchGameDetailBySlug(slug);
    if (!detail) {
      return c.json({ error: "not found" }, 404);
    }
    await upsertDetail(database, detail);
    return c.json(detail);
  });
}
