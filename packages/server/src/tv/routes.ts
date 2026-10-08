import type {
  CastMember,
  MediaVideo,
  TvAiring,
  TvDetail,
  TvMetadata,
  TvScheduledEpisode,
  TvSeason,
} from "@shelfie/shared";
import type { Hono } from "hono";
import type { Kysely } from "kysely";
import { db as defaultDb } from "../db/index.js";
import type { Database, TvMetadataTable } from "../db/types.js";
import { fetchTvCard, fetchTvDetail, searchTv } from "../tmdb/client.js";
import type { CachedCard, MetadataCollection } from "../metadata/collection.js";
import { parseIds, registerMetadataRoutes } from "../metadata/routes.js";
import { isIsoDay, nextEpisodeExpired, scheduleForShow } from "./schedule.js";

function metadataRowToDto(row: TvMetadataTable): TvMetadata {
  return {
    tmdbId: row.tmdb_id,
    name: row.name,
    posterPath: row.poster_path,
    genres: JSON.parse(row.genres) as string[],
    firstAirYear: row.first_air_year,
    status: row.status,
    numberOfSeasons: row.number_of_seasons,
    numberOfEpisodes: row.number_of_episodes,
    networks: JSON.parse(row.networks) as string[],
    createdBy: JSON.parse(row.created_by) as string[],
    summary: row.summary,
    nextEpisodeToAir: row.next_episode
      ? (JSON.parse(row.next_episode) as TvAiring)
      : null,
  };
}

function metadataToRow(metadata: TvMetadata): TvMetadataTable {
  return {
    tmdb_id: metadata.tmdbId,
    name: metadata.name,
    poster_path: metadata.posterPath,
    genres: JSON.stringify(metadata.genres),
    first_air_year: metadata.firstAirYear,
    status: metadata.status,
    number_of_seasons: metadata.numberOfSeasons,
    number_of_episodes: metadata.numberOfEpisodes,
    networks: JSON.stringify(metadata.networks),
    created_by: JSON.stringify(metadata.createdBy),
    summary: metadata.summary,
    next_episode: metadata.nextEpisodeToAir
      ? JSON.stringify(metadata.nextEpisodeToAir)
      : null,
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
    fetched_at: Date.now(),
    detail_fetched_at: null,
  };
}

function metadataRowToDetail(row: TvMetadataTable): TvDetail {
  return {
    ...metadataRowToDto(row),
    backdropPath: row.backdrop_path,
    tagline: row.tagline,
    certification: row.certification,
    voteAverage: row.vote_average,
    voteCount: row.vote_count ?? 0,
    videos: JSON.parse(row.videos ?? "[]") as MediaVideo[],
    cast: JSON.parse(row.cast_members ?? "[]") as CastMember[],
    seasons: JSON.parse(row.seasons ?? "[]") as TvSeason[],
    lastAirDate: row.last_air_date,
    inProduction: row.in_production === 1,
    imdbId: row.imdb_id,
  };
}

function detailToRow(detail: TvDetail): TvMetadataTable {
  return {
    ...metadataToRow(detail),
    backdrop_path: detail.backdropPath,
    tagline: detail.tagline,
    certification: detail.certification,
    vote_average: detail.voteAverage,
    vote_count: detail.voteCount,
    videos: JSON.stringify(detail.videos),
    cast_members: JSON.stringify(detail.cast),
    seasons: JSON.stringify(detail.seasons),
    last_air_date: detail.lastAirDate,
    in_production: detail.inProduction ? 1 : 0,
    imdb_id: detail.imdbId,
    detail_fetched_at: Date.now(),
  };
}

/** Upserts a fetched show's card row into the cache, keyed by tmdb_id. Never overwrites detail-only columns. */
async function upsertMetadata(
  database: Kysely<Database>,
  metadata: TvMetadata,
): Promise<TvMetadataTable> {
  const row = metadataToRow(metadata);
  await database
    .insertInto("tv_metadata")
    .values(row)
    .onConflict((oc) =>
      oc.column("tmdb_id").doUpdateSet({
        name: row.name,
        poster_path: row.poster_path,
        genres: row.genres,
        first_air_year: row.first_air_year,
        status: row.status,
        number_of_seasons: row.number_of_seasons,
        number_of_episodes: row.number_of_episodes,
        networks: row.networks,
        created_by: row.created_by,
        summary: row.summary,
        next_episode: row.next_episode,
        fetched_at: row.fetched_at,
      }),
    )
    .execute();
  return row;
}

/** Upserts a fetched show's detail row into the cache, backfilling card columns in place. */
async function upsertDetail(
  database: Kysely<Database>,
  detail: TvDetail,
): Promise<TvMetadataTable> {
  const row = detailToRow(detail);
  await database
    .insertInto("tv_metadata")
    .values(row)
    .onConflict((oc) =>
      oc.column("tmdb_id").doUpdateSet({
        name: row.name,
        poster_path: row.poster_path,
        genres: row.genres,
        first_air_year: row.first_air_year,
        status: row.status,
        number_of_seasons: row.number_of_seasons,
        number_of_episodes: row.number_of_episodes,
        networks: row.networks,
        created_by: row.created_by,
        summary: row.summary,
        next_episode: row.next_episode,
        fetched_at: row.fetched_at,
        backdrop_path: row.backdrop_path,
        tagline: row.tagline,
        certification: row.certification,
        vote_average: row.vote_average,
        vote_count: row.vote_count,
        videos: row.videos,
        cast_members: row.cast_members,
        seasons: row.seasons,
        last_air_date: row.last_air_date,
        in_production: row.in_production,
        imdb_id: row.imdb_id,
        detail_fetched_at: row.detail_fetched_at,
      }),
    )
    .execute();
  return row;
}

const tvMetadataCollection: MetadataCollection<TvMetadata, TvDetail> = {
  basePath: "/api/tv",

  search: searchTv,

  cardId: (card) => card.tmdbId,

  isExpired: (card, fetchedAt, now) =>
    nextEpisodeExpired(card.nextEpisodeToAir, fetchedAt, now),

  async fetchCachedCards(database, ids) {
    const cached = await database
      .selectFrom("tv_metadata")
      .selectAll()
      .where("tmdb_id", "in", ids)
      .execute();

    const result = new Map<number, CachedCard<TvMetadata>>();
    for (const row of cached) {
      result.set(row.tmdb_id, {
        card: metadataRowToDto(row),
        fetchedAt: row.fetched_at,
      });
    }
    return result;
  },

  async fetchMissingCards(database, missingIds) {
    // TMDB has no batch-by-id endpoint; fan the missing ids out through
    // the client's throttle queue.
    const fetched = await Promise.all(missingIds.map((id) => fetchTvCard(id)));
    const cards: TvMetadata[] = [];
    for (const metadata of fetched) {
      const row = await upsertMetadata(database, metadata);
      cards.push(metadataRowToDto(row));
    }
    return cards;
  },

  detail: {
    path: "by-id/:id",
    param: "id",

    parseKey(raw) {
      const id = Number(raw);
      return Number.isInteger(id) ? id : undefined;
    },

    async fetchCached(database, id) {
      const cached = await database
        .selectFrom("tv_metadata")
        .selectAll()
        .where("tmdb_id", "=", id)
        .executeTakeFirst();
      if (!cached) return null;
      return {
        detail: metadataRowToDetail(cached),
        detailFetchedAt: cached.detail_fetched_at,
      };
    },

    fetchFromSource: (id) => fetchTvDetail(id),

    upsert: (database, detail) => upsertDetail(database, detail),
  },
};

export function registerTvRoutes(
  app: Hono,
  database: Kysely<Database> = defaultDb,
): void {
  registerMetadataRoutes(app, database, tvMetadataCollection);

  // Cache-only: reads whatever card/detail rows exist and never calls TMDB,
  // so it stays cheap for a whole library. The client warms cards first via
  // GET /api/tv?ids=, and detail screens/the library keep catalogs warm.
  app.get("/api/tv/schedule", async (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (!isIsoDay(from) || !isIsoDay(to) || from > to) {
      return c.json(
        { error: "from and to must be YYYY-MM-DD, from <= to" },
        400,
      );
    }
    const idsParam = c.req.query("ids");
    const ids = idsParam ? parseIds(idsParam) : [];
    if (ids.length === 0) return c.json<TvScheduledEpisode[]>([]);

    const rows = await database
      .selectFrom("tv_metadata")
      .select(["tmdb_id", "seasons", "next_episode"])
      .where("tmdb_id", "in", ids)
      .execute();

    const episodes = rows.flatMap((row) =>
      scheduleForShow(
        row.tmdb_id,
        JSON.parse(row.seasons ?? "[]") as TvSeason[],
        row.next_episode ? (JSON.parse(row.next_episode) as TvAiring) : null,
        from,
        to,
      ),
    );
    episodes.sort(
      (a, b) =>
        a.airDate.localeCompare(b.airDate) ||
        a.tmdbId - b.tmdbId ||
        a.seasonNumber - b.seasonNumber ||
        a.episodeNumber - b.episodeNumber,
    );
    return c.json(episodes);
  });
}
