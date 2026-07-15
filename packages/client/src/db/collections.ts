import {
  libraryItemConflictHandler,
  libraryItemMigrationStrategies,
  libraryItemSchema,
} from "@shelfie/shared";

/**
 * Collection definitions built from the shared schema. Keeping this separate
 * from database creation makes the contract surface obvious: every collection
 * here is mirrored by a table the server knows how to sync.
 */
export const collections = {
  library_items: {
    schema: libraryItemSchema,
    migrationStrategies: libraryItemMigrationStrategies,
    conflictHandler: libraryItemConflictHandler,
  },
};
