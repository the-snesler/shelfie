import type { BookMetadata } from "@shelfie/shared";
import type { RxJsonSchema } from "rxdb";
import type { ShelfieDatabase } from "./database";

/**
 * Local-only (never replicated) projection of the card tier of book
 * metadata. Cached client-side so the library grid renders covers/titles
 * offline; refreshed over HTTP on mount (see `features/library/Library.tsx`).
 */
export interface BookCardDoc {
  id: string;
  goodreadsId: number;
  name: string;
  coverUrl: string | null;
  authors: string[];
  year: number | null;
  pageCount: number | null;
}

export const bookCardSchema: RxJsonSchema<BookCardDoc> = {
  title: "book card cache schema",
  version: 0,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 64 },
    goodreadsId: {
      type: "number",
      minimum: 0,
      maximum: 9007199254740991,
      multipleOf: 1,
    },
    name: { type: "string", maxLength: 256 },
    coverUrl: { type: ["string", "null"], maxLength: 512 },
    authors: { type: "array", items: { type: "string", maxLength: 256 } },
    year: {
      type: ["number", "null"],
      minimum: 0,
      maximum: 9999,
      multipleOf: 1,
    },
    pageCount: {
      type: ["number", "null"],
      minimum: 0,
      maximum: 9007199254740991,
      multipleOf: 1,
    },
  },
  required: ["id", "goodreadsId", "name", "authors"],
} as const;

/** Explicit field-by-field projection — never spread, so a `BookDetail` passed in drops its heavy fields and stays valid against the schema. */
export function cardToDoc(card: BookMetadata): BookCardDoc {
  return {
    id: `book:${card.goodreadsId}`,
    goodreadsId: card.goodreadsId,
    name: card.name,
    coverUrl: card.coverUrl,
    authors: card.authors,
    year: card.year,
    pageCount: card.pageCount,
  };
}

export async function upsertBookCards(
  db: ShelfieDatabase,
  cards: BookMetadata[],
): Promise<void> {
  if (cards.length === 0) return;
  await db.book_metadata.bulkUpsert(cards.map(cardToDoc));
}
