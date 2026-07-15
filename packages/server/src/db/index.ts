import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect, type Dialect } from "kysely";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { runMigrations } from "./migrations.js";
import { initSequence } from "./sequence.js";
import type { Database } from "./types.js";

/**
 * Dialect switch seam. Today only SQLite is wired; the structure is here so a
 * Postgres dialect (PostgresDialect + pg) can drop in behind DATABASE_URL
 * without touching the sync layer.
 */
function createDialect(): Dialect {
  const url = process.env.DATABASE_URL;

  if (url && url.startsWith("postgres")) {
    throw new Error(
      "Postgres is not implemented yet. TODO: return `new PostgresDialect({ pool: new Pool({ connectionString: url }) })` here.",
    );
  }

  const path = resolveSqlitePath(url);
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new BetterSqlite3(path);
  sqlite.pragma("journal_mode = WAL");
  return new SqliteDialect({ database: sqlite });
}

function resolveSqlitePath(url?: string): string {
  if (url && url.startsWith("sqlite://")) {
    return url.slice("sqlite://".length);
  }
  const dataDir = process.env.DATA_DIR ?? "./data";
  return join(dataDir, "shelfie.sqlite");
}

export const db = new Kysely<Database>({ dialect: createDialect() });

export async function initDb(): Promise<void> {
  await runMigrations(db);

  // Prime each synced collection's seq counter from its table so a server
  // restart keeps assigning monotonically increasing cursors.
  const libraryItemsMax = await db
    .selectFrom("library_items")
    .select((eb) => eb.fn.max<number>("seq").as("maxSeq"))
    .executeTakeFirst();
  initSequence("library_items", Number(libraryItemsMax?.maxSeq ?? 0));
}
