import type { RxDocumentData } from "rxdb";
import {
  libraryItemConflictHandler,
  libraryItemMigrationStrategies,
  libraryItemSchema,
} from "@shelfie/shared";
import { bookCardSchema, type BookCardDoc } from "./bookCards";
import { gameCardSchema, type GameCardDoc } from "./gameCards";
import { movieCardSchema, type MovieCardDoc } from "./movieCards";
import { tvCardSchema, type TvCardDoc } from "./tvCards";

/** A v0 movie/book card doc: a bare `year` instead of the ISO date. */
type YearOnlyDoc<TDoc> = RxDocumentData<TDoc> & { year?: number | null };

/**
 * Collection definitions built from the shared schema. Keeping this separate
 * from database creation makes the contract surface obvious: every collection
 * here is mirrored by a table the server knows how to sync — except the
 * `*_metadata` cache collections, which are deliberately local-only (no
 * conflictHandler, never passed to `startReplication`).
 */
export const collections = {
  library_items: {
    schema: libraryItemSchema,
    migrationStrategies: libraryItemMigrationStrategies,
    conflictHandler: libraryItemConflictHandler,
  },
  game_metadata: {
    schema: gameCardSchema,
    migrationStrategies: {
      1: (doc: RxDocumentData<GameCardDoc>) => ({ ...doc, timeToBeat: null }),
    },
  },
  movie_metadata: {
    schema: movieCardSchema,
    migrationStrategies: {
      // v0 carried only a year; the date arrives with the next card refresh.
      1: ({ year: _year, ...doc }: YearOnlyDoc<MovieCardDoc>) => ({
        ...doc,
        releaseDate: null,
      }),
    },
  },
  tv_metadata: {
    schema: tvCardSchema,
    migrationStrategies: {
      1: (doc: RxDocumentData<TvCardDoc>) => ({
        ...doc,
        nextEpisodeToAir: null,
      }),
    },
  },
  book_metadata: {
    schema: bookCardSchema,
    migrationStrategies: {
      1: ({ year: _year, ...doc }: YearOnlyDoc<BookCardDoc>) => ({
        ...doc,
        publicationDate: null,
      }),
    },
  },
};
