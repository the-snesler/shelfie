import type { LibraryItem } from "@shelfie/shared";
import type { BookCardDoc } from "./bookCards";
import type { GameCardDoc } from "./gameCards";
import type { MovieCardDoc } from "./movieCards";
import type { TvCardDoc } from "./tvCards";
import {
  addRxPlugin,
  createRxDatabase,
  type RxCollection,
  type RxDatabase,
} from "rxdb";
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode";
import { RxDBMigrationSchemaPlugin } from "rxdb/plugins/migration-schema";
import { getRxStorageDexie } from "rxdb/plugins/storage-dexie";
import { wrappedValidateAjvStorage } from "rxdb/plugins/validate-ajv";
import { collections } from "./collections";

addRxPlugin(RxDBMigrationSchemaPlugin);

if (import.meta.env.DEV) {
  addRxPlugin(RxDBDevModePlugin);
}

// The dev-mode plugin requires the storage to be wrapped in a schema
// validator (error DVM1). In prod we skip the validator for performance —
// the dev-mode plugin is never registered there either.
const storage = import.meta.env.DEV
  ? wrappedValidateAjvStorage({ storage: getRxStorageDexie() })
  : getRxStorageDexie();

export type LibraryItemCollection = RxCollection<LibraryItem>;
export interface ShelfieCollections {
  library_items: LibraryItemCollection;
  game_metadata: RxCollection<GameCardDoc>;
  movie_metadata: RxCollection<MovieCardDoc>;
  tv_metadata: RxCollection<TvCardDoc>;
  book_metadata: RxCollection<BookCardDoc>;
}
export type ShelfieDatabase = RxDatabase<ShelfieCollections>;

let dbPromise: Promise<ShelfieDatabase> | null = null;

/**
 * Memoized singleton. RxDB throws if a database of the same name is created
 * twice, so we build it once at module scope rather than inside a React
 * effect (which may run twice in dev under certain conditions).
 */
export function getDatabase(): Promise<ShelfieDatabase> {
  if (!dbPromise) dbPromise = createDatabase();
  return dbPromise;
}

async function createDatabase(): Promise<ShelfieDatabase> {
  const db = await createRxDatabase<ShelfieCollections>({
    name: "shelfiedb",
    storage,
    multiInstance: true,
    eventReduce: true,
  });
  await db.addCollections(collections);
  return db;
}
