import type {
  CastMember,
  MediaVideo,
  MovieDetail,
  MovieMetadata,
} from "@shelfie/shared";
import type { Hono } from "hono";
import type { Kysely } from "kysely";
import { db as defaultDb } from "../db/index.js";
import type { Database, MovieMetadataTable } from "../db/types.js";
import {
  fetchMovieCard,
  fetchMovieDetail,
  searchMovies,
} from "../tmdb/client.js";
import type { CachedCard, MetadataCollection } from "../metadata/collection.js";
import { registerMetadataRoutes } from "../metadata/routes.js";

function metadataRowToDto(row: MovieMetadataTable): MovieMetadata {
  return {
    tmdbId: row.tmdb_id,
    name: row.name,
    posterPath: row.poster_path,
    genres: JSON.parse(row.genres) as string[],
    year: row.year,
    director: row.director,
    runtime: row.runtime,
    summary: row.summary,
  };
}

function metadataToRow(metadata: MovieMetadata): MovieMetadataTable {
  return {
    tmdb_id: metadata.tmdbId,
    name: metadata.name,
    poster_path: metadata.posterPath,
    genres: JSON.stringify(metadata.genres),
    year: metadata.year,
    director: metadata.director,
    runtime: metadata.runtime,
    summary: metadata.summary,
    backdrop_path: null,
    tagline: null,
    certification: null,
    vote_average: null,
    vote_count: null,
    videos: null,
    cast_members: null,
    imdb_id: null,
    fetched_at: Date.now(),
    detail_fetched_at: null,
  };
}

function metadataRowToDetail(row: MovieMetadataTable): MovieDetail {
  return {
    ...metadataRowToDto(row),
    backdropPath: row.backdrop_path,
    tagline: row.tagline,
    certification: row.certification,
    voteAverage: row.vote_average,
    voteCount: row.vote_count ?? 0,
    videos: JSON.parse(row.videos ?? "[]") as MediaVideo[],
    cast: JSON.parse(row.cast_members ?? "[]") as CastMember[],
    imdbId: row.imdb_id,
  };
}

function detailToRow(detail: MovieDetail): MovieMetadataTable {
  return {
    ...metadataToRow(detail),
    backdrop_path: detail.backdropPath,
    tagline: detail.tagline,
    certification: detail.certification,
    vote_average: detail.voteAverage,
    vote_count: detail.voteCount,
    videos: JSON.stringify(detail.videos),
    cast_members: JSON.stringify(detail.cast),
    imdb_id: detail.imdbId,
    detail_fetched_at: Date.now(),
  };
}

/** Upserts a fetched movie's card row into the cache, keyed by tmdb_id. Never overwrites detail-only columns. */
async function upsertMetadata(
  database: Kysely<Database>,
  metadata: MovieMetadata,
): Promise<MovieMetadataTable> {
  const row = metadataToRow(metadata);
  await database
    .insertInto("movie_metadata")
    .values(row)
    .onConflict((oc) =>
      oc.column("tmdb_id").doUpdateSet({
        name: row.name,
        poster_path: row.poster_path,
        genres: row.genres,
        year: row.year,
        director: row.director,
        runtime: row.runtime,
        summary: row.summary,
        fetched_at: row.fetched_at,
      }),
    )
    .execute();
  return row;
}

/** Upserts a fetched movie's detail row into the cache, backfilling card columns in place. */
async function upsertDetail(
  database: Kysely<Database>,
  detail: MovieDetail,
): Promise<MovieMetadataTable> {
  const row = detailToRow(detail);
  await database
    .insertInto("movie_metadata")
    .values(row)
    .onConflict((oc) =>
      oc.column("tmdb_id").doUpdateSet({
        name: row.name,
        poster_path: row.poster_path,
        genres: row.genres,
        year: row.year,
        director: row.director,
        runtime: row.runtime,
        summary: row.summary,
        fetched_at: row.fetched_at,
        backdrop_path: row.backdrop_path,
        tagline: row.tagline,
        certification: row.certification,
        vote_average: row.vote_average,
        vote_count: row.vote_count,
        videos: row.videos,
        cast_members: row.cast_members,
        imdb_id: row.imdb_id,
        detail_fetched_at: row.detail_fetched_at,
      }),
    )
    .execute();
  return row;
}

const moviesMetadataCollection: MetadataCollection<MovieMetadata, MovieDetail> =
  {
    basePath: "/api/movies",

    search: searchMovies,

    cardId: (card) => card.tmdbId,

    async fetchCachedCards(database, ids) {
      const cached = await database
        .selectFrom("movie_metadata")
        .selectAll()
        .where("tmdb_id", "in", ids)
        .execute();

      const result = new Map<number, CachedCard<MovieMetadata>>();
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
      const fetched = await Promise.all(
        missingIds.map((id) => fetchMovieCard(id)),
      );
      const cards: MovieMetadata[] = [];
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
          .selectFrom("movie_metadata")
          .selectAll()
          .where("tmdb_id", "=", id)
          .executeTakeFirst();
        if (!cached) return null;
        return {
          detail: metadataRowToDetail(cached),
          detailFetchedAt: cached.detail_fetched_at,
        };
      },

      fetchFromSource: (id) => fetchMovieDetail(id),

      upsert: (database, detail) => upsertDetail(database, detail),
    },
  };

export function registerMoviesRoutes(
  app: Hono,
  database: Kysely<Database> = defaultDb,
): void {
  registerMetadataRoutes(app, database, moviesMetadataCollection);
}
