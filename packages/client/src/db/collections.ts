import type { RxDocumentData } from "rxdb";
import {
  libraryItemConflictHandler,
  libraryItemMigrationStrategies,
  libraryItemSchema,
} from "@shelfie/shared";
import { gameCardSchema, type GameCardDoc } from "./gameCards";

/**
 * Collection definitions built from the shared schema. Keeping this separate
 * from database creation makes the contract surface obvious: every collection
 * here is mirrored by a table the server knows how to sync — except
 * `game_metadata`, which is deliberately local-only (no conflictHandler,
 * never passed to `startReplication`).
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
};
