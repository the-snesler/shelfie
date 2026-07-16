import type { GameMetadata, PlatformRelease } from "@shelfie/shared";
import type { RxJsonSchema } from "rxdb";
import type { ShelfieDatabase } from "./database";

/**
 * Local-only (never replicated) projection of the card tier of game
 * metadata. Cached client-side so the library grid renders covers/titles
 * offline; refreshed over HTTP on mount (see `features/library/Library.tsx`).
 */
export interface GameCardDoc {
  id: string;
  igdbId: number;
  slug: string | null;
  name: string;
  coverImageId: string | null;
  summary: string | null;
  genres: string[];
  platforms: string[];
  platformReleaseDates: PlatformRelease[];
  developer: string | null;
  firstReleaseDate: number | null;
  cachedAt: number;
}

export const gameCardSchema: RxJsonSchema<GameCardDoc> = {
  title: "game card cache schema",
  version: 0,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 64 },
    igdbId: { type: "number", minimum: 0, maximum: 9007199254740991, multipleOf: 1 },
    slug: { type: ["string", "null"], maxLength: 128 },
    name: { type: "string", maxLength: 256 },
    coverImageId: { type: ["string", "null"], maxLength: 64 },
    summary: { type: ["string", "null"] },
    genres: { type: "array", items: { type: "string", maxLength: 64 } },
    platforms: { type: "array", items: { type: "string", maxLength: 64 } },
    platformReleaseDates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          platform: { type: "string" },
          date: { type: "number" },
        },
        required: ["platform", "date"],
      },
    },
    developer: { type: ["string", "null"], maxLength: 256 },
    firstReleaseDate: {
      type: ["number", "null"],
      minimum: 0,
      maximum: 9007199254740991,
      multipleOf: 1,
    },
    cachedAt: {
      type: "number",
      minimum: 0,
      maximum: 9007199254740991,
      multipleOf: 1,
    },
  },
  required: [
    "id",
    "igdbId",
    "name",
    "genres",
    "platforms",
    "platformReleaseDates",
    "cachedAt",
  ],
} as const;

/** Explicit field-by-field projection — never spread, so a `GameDetail` passed in drops its heavy fields and stays valid against the schema. */
export function cardToDoc(card: GameMetadata): GameCardDoc {
  return {
    id: `game:${card.igdbId}`,
    igdbId: card.igdbId,
    slug: card.slug,
    name: card.name,
    coverImageId: card.coverImageId,
    summary: card.summary,
    genres: card.genres,
    platforms: card.platforms,
    platformReleaseDates: card.platformReleaseDates,
    developer: card.developer,
    firstReleaseDate: card.firstReleaseDate,
    cachedAt: Date.now(),
  };
}

export async function upsertCards(
  db: ShelfieDatabase,
  cards: GameMetadata[],
): Promise<void> {
  if (cards.length === 0) return;
  await db.game_metadata.bulkUpsert(cards.map(cardToDoc));
}
