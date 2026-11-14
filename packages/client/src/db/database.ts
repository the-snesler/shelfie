import type { LibraryItem } from "@shelfie/shared";
import { recordItemActivity } from "@shelfie/shared";
import type { BookCardDoc } from "./bookCards";
import type { GameCardDoc } from "./gameCards";
import type { MovieCardDoc } from "./movieCards";
import type { TvCardDoc } from "./tvCards";
import {
  addRxPlugin,
  randomToken,
  createRxDatabase,
  type RxCollection,
  type RxDatabase,
} from "rxdb";
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode";
import { RxDBMigrationSchemaPlugin } from "rxdb/plugins/migration-schema";
import { getRxStorageDexie } from "rxdb/plugins/storage-dexie";
import { wrappedValidateAjvStorage } from "rxdb/plugins/validate-ajv";
import { collections } from "./collections";
import { startCardCacheLifecycle } from "./cardCache";

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

/** `owner` is the signed-in library, replicated to the server. `guest` is a
 * visitor's local-only shelf: never replicated, and kept in its own
 * IndexedDB database so signing out never exposes the owner's library and
 * guest items never reach the server. */
export type DatabaseScope = "owner" | "guest";

const DATABASE_NAMES: Record<DatabaseScope, string> = {
  owner: "shelfiedb",
  guest: "shelfiedb-guest",
};

const dbPromises = new Map<DatabaseScope, Promise<ShelfieDatabase>>();

/**
 * Memoized per scope. RxDB throws if a database of the same name is created
 * twice, so each is built once at module scope rather than inside a React
 * effect (which may run twice in dev under certain conditions).
 */
export function getDatabase(
  scope: DatabaseScope = "owner",
): Promise<ShelfieDatabase> {
  let promise = dbPromises.get(scope);
  if (!promise) {
    promise = createDatabase(DATABASE_NAMES[scope]);
    dbPromises.set(scope, promise);
  }
  return promise;
}

async function createDatabase(name: string): Promise<ShelfieDatabase> {
  const db = await createRxDatabase<ShelfieCollections>({
    name,
    storage,
    multiInstance: true,
    eventReduce: true,
  });
  await db.addCollections(collections);
  db.library_items.preInsert((data) => {
    if (data.activity.length === 0)
      recordItemActivity(data, undefined, Date.now(), randomToken(24));
  }, false);
  db.library_items.preSave((data, previous) => {
    recordItemActivity(data, previous, Date.now(), randomToken(24));
  }, false);
  const stopCardCacheLifecycle = startCardCacheLifecycle(db);
  db.onClose.push(async () => stopCardCacheLifecycle());
  return db;
}
