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

const METADATA_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

function parseIds(raw: string): number[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => Number(part))
    .filter((id) => Number.isInteger(id));
}

export function registerMoviesRoutes(
  app: Hono,
  database: Kysely<Database> = defaultDb,
): void {
  app.get("/api/movies/search", async (c) => {
    const q = c.req.query("q");
    if (!q || q.trim().length === 0) {
      return c.json({ error: "q is required" }, 400);
    }
    const results = await searchMovies(q);
    return c.json(results);
  });

  app.get("/api/movies", async (c) => {
    const idsParam = c.req.query("ids");
    const ids = idsParam ? parseIds(idsParam) : [];
    if (ids.length === 0) return c.json<MovieMetadata[]>([]);

    const cached = await database
      .selectFrom("movie_metadata")
      .selectAll()
      .where("tmdb_id", "in", ids)
      .execute();
    const cachedById = new Map(cached.map((row) => [row.tmdb_id, row]));

    const missingIds = ids.filter((id) => {
      const row = cachedById.get(id);
      return !row || row.fetched_at < Date.now() - METADATA_TTL_MS;
    });
    if (missingIds.length > 0) {
      // TMDB has no batch-by-id endpoint; fan the missing ids out through
      // the client's throttle queue.
      const fetched = await Promise.all(
        missingIds.map((id) => fetchMovieCard(id)),
      );
      for (const metadata of fetched) {
        const row = await upsertMetadata(database, metadata);
        cachedById.set(metadata.tmdbId, row);
      }
    }

    const results: MovieMetadata[] = [];
    for (const id of ids) {
      const row = cachedById.get(id);
      if (row) results.push(metadataRowToDto(row));
    }
    return c.json(results);
  });

  app.get("/api/movies/by-id/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) {
      return c.json({ error: "invalid id" }, 400);
    }

    const cached = await database
      .selectFrom("movie_metadata")
      .selectAll()
      .where("tmdb_id", "=", id)
      .executeTakeFirst();
    if (
      cached &&
      cached.detail_fetched_at !== null &&
      cached.detail_fetched_at >= Date.now() - METADATA_TTL_MS
    ) {
      return c.json(metadataRowToDetail(cached));
    }

    const detail = await fetchMovieDetail(id);
    await upsertDetail(database, detail);
    return c.json(detail);
  });
}
