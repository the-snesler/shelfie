import type { MovieMetadata } from "@shelfie/shared";
import type { RxJsonSchema } from "rxdb";
import type { ShelfieDatabase } from "./database";

/**
 * Local-only (never replicated) projection of the card tier of movie
 * metadata. Cached client-side so the library grid renders covers/titles
 * offline; refreshed over HTTP on mount (see `features/library/Library.tsx`).
 */
export interface MovieCardDoc {
  id: string;
  tmdbId: number;
  name: string;
  posterPath: string | null;
  genres: string[];
  year: number | null;
  director: string | null;
  runtime: number | null;
}

export const movieCardSchema: RxJsonSchema<MovieCardDoc> = {
  title: "movie card cache schema",
  version: 0,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 64 },
    tmdbId: {
      type: "number",
      minimum: 0,
      maximum: 9007199254740991,
      multipleOf: 1,
    },
    name: { type: "string", maxLength: 256 },
    posterPath: { type: ["string", "null"], maxLength: 256 },
    genres: { type: "array", items: { type: "string", maxLength: 64 } },
    year: {
      type: ["number", "null"],
      minimum: 0,
      maximum: 9999,
      multipleOf: 1,
    },
    director: { type: ["string", "null"], maxLength: 256 },
    runtime: {
      type: ["number", "null"],
      minimum: 0,
      maximum: 9007199254740991,
      multipleOf: 1,
    },
  },
  required: ["id", "tmdbId", "name", "genres"],
} as const;

/** Explicit field-by-field projection — never spread, so a `MovieDetail` passed in drops its heavy fields and stays valid against the schema. */
export function cardToDoc(card: MovieMetadata): MovieCardDoc {
  return {
    id: `movie:${card.tmdbId}`,
    tmdbId: card.tmdbId,
    name: card.name,
    posterPath: card.posterPath,
    genres: card.genres,
    year: card.year,
    director: card.director,
    runtime: card.runtime,
  };
}

export async function upsertMovieCards(
  db: ShelfieDatabase,
  cards: MovieMetadata[],
): Promise<void> {
  if (cards.length === 0) return;
  await db.movie_metadata.bulkUpsert(cards.map(cardToDoc));
}
