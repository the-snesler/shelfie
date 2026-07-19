import type { RxDocumentData } from "rxdb";
import {
  libraryItemConflictHandler,
  libraryItemMigrationStrategies,
  libraryItemSchema,
} from "@shelfie/shared";
import { bookCardSchema } from "./bookCards";
import { gameCardSchema, type GameCardDoc } from "./gameCards";
import { movieCardSchema } from "./movieCards";
import { tvCardSchema } from "./tvCards";

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
  },
  tv_metadata: {
    schema: tvCardSchema,
  },
  book_metadata: {
    schema: bookCardSchema,
  },
};
