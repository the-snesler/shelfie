import type { TvMetadata } from "@shelfie/shared";
import type { RxJsonSchema } from "rxdb";
import type { ShelfieDatabase } from "./database";

/**
 * Local-only (never replicated) projection of the card tier of TV metadata.
 * Cached client-side so the library grid renders covers/titles/progress
 * offline; refreshed over HTTP on mount (see `features/library/Library.tsx`).
 */
export interface TvCardDoc {
  id: string;
  tmdbId: number;
  name: string;
  posterPath: string | null;
  genres: string[];
  firstAirYear: number | null;
  status: string | null;
  numberOfSeasons: number;
  numberOfEpisodes: number;
}

export const tvCardSchema: RxJsonSchema<TvCardDoc> = {
  title: "tv card cache schema",
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
    firstAirYear: {
      type: ["number", "null"],
      minimum: 0,
      maximum: 9999,
      multipleOf: 1,
    },
    status: { type: ["string", "null"], maxLength: 64 },
    numberOfSeasons: {
      type: "number",
      minimum: 0,
      maximum: 9007199254740991,
      multipleOf: 1,
    },
    numberOfEpisodes: {
      type: "number",
      minimum: 0,
      maximum: 9007199254740991,
      multipleOf: 1,
    },
  },
  required: [
    "id",
    "tmdbId",
    "name",
    "genres",
    "numberOfSeasons",
    "numberOfEpisodes",
  ],
} as const;

/** Explicit field-by-field projection — never spread, so a `TvDetail` passed in drops its heavy fields and stays valid against the schema. */
export function cardToDoc(card: TvMetadata): TvCardDoc {
  return {
    id: `tv:${card.tmdbId}`,
    tmdbId: card.tmdbId,
    name: card.name,
    posterPath: card.posterPath,
    genres: card.genres,
    firstAirYear: card.firstAirYear,
    status: card.status,
    numberOfSeasons: card.numberOfSeasons,
    numberOfEpisodes: card.numberOfEpisodes,
  };
}

export async function upsertTvCards(
  db: ShelfieDatabase,
  cards: TvMetadata[],
): Promise<void> {
  if (cards.length === 0) return;
  await db.tv_metadata.bulkUpsert(cards.map(cardToDoc));
}
