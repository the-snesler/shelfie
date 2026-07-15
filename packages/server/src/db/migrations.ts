import type { Kysely } from "kysely";
import type { Database } from "./types.js";

/**
 * A single numbered, named migration. `up` runs inside a transaction; the
 * runner records `(id, name, applied_at)` in the `migrations` bookkeeping
 * table immediately after so a partially-applied migration never gets marked
 * done. Deliberately deviates from aside's create-tables-on-startup approach
 * (`ifNotExists()` everywhere, no bookkeeping) — shelfie expects to grow new
 * media types and fields, so every schema change is a new numbered entry
 * appended to `migrations` below, never an edit to an already-shipped one.
 */
interface Migration {
  id: number;
  name: string;
  up(db: Kysely<Database>): Promise<void>;
}

const migrations: Migration[] = [
  {
    id: 1,
    name: "initial",
    async up(db) {
      await db.schema
        .createTable("library_items")
        .ifNotExists()
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("media_type", "text", (c) => c.notNull())
        .addColumn("source_id", "text", (c) => c.notNull())
        .addColumn("status", "text", (c) => c.notNull())
        .addColumn("progress", "integer")
        .addColumn("added_at", "integer", (c) => c.notNull())
        .addColumn("updated_at", "integer", (c) => c.notNull())
        .addColumn("seq", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("deleted", "integer", (c) => c.notNull().defaultTo(0))
        .execute();

      await db.schema
        .createIndex("library_items_seq")
        .ifNotExists()
        .on("library_items")
        .column("seq")
        .execute();

      await db.schema
        .createTable("game_metadata")
        .ifNotExists()
        .addColumn("igdb_id", "integer", (c) => c.primaryKey())
        .addColumn("name", "text", (c) => c.notNull())
        .addColumn("cover_image_id", "text")
        .addColumn("summary", "text")
        .addColumn("genres", "text", (c) => c.notNull())
        .addColumn("platforms", "text", (c) => c.notNull())
        .addColumn("developer", "text")
        .addColumn("first_release_date", "integer")
        .addColumn("fetched_at", "integer", (c) => c.notNull())
        .execute();

      await db.schema
        .createTable("auth_owner")
        .ifNotExists()
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("password_hash", "text", (c) => c.notNull())
        .addColumn("created_at", "integer", (c) => c.notNull())
        .addColumn("updated_at", "integer", (c) => c.notNull())
        .execute();

      await db.schema
        .createTable("auth_sessions")
        .ifNotExists()
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("token_hash", "text", (c) => c.notNull().unique())
        .addColumn("created_at", "integer", (c) => c.notNull())
        .addColumn("last_seen_at", "integer", (c) => c.notNull())
        .addColumn("user_agent", "text")
        .addColumn("revoked_at", "integer")
        .execute();

      await db.schema
        .createIndex("auth_sessions_token_hash")
        .ifNotExists()
        .on("auth_sessions")
        .column("token_hash")
        .execute();
    },
  },
  {
    id: 2,
    name: "game-metadata-slug",
    async up(db) {
      await db.schema
        .alterTable("game_metadata")
        .addColumn("slug", "text")
        .execute();

      await db.schema
        .createIndex("game_metadata_slug")
        .ifNotExists()
        .unique()
        .on("game_metadata")
        .column("slug")
        .execute();
    },
  },
];

/**
 * Ensures the `migrations` bookkeeping table exists, then applies every
 * migration whose id has not yet been recorded, in ascending id order, each
 * inside its own transaction.
 */
export async function runMigrations(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("migrations")
    .ifNotExists()
    .addColumn("id", "integer", (c) => c.primaryKey())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("applied_at", "integer", (c) => c.notNull())
    .execute();

  const applied = await db.selectFrom("migrations").select("id").execute();
  const appliedIds = new Set(applied.map((row) => row.id));

  const pending = migrations
    .filter((migration) => !appliedIds.has(migration.id))
    .sort((a, b) => a.id - b.id);

  for (const migration of pending) {
    await db.transaction().execute(async (trx) => {
      await migration.up(trx);
      await trx
        .insertInto("migrations")
        .values({
          id: migration.id,
          name: migration.name,
          applied_at: Date.now(),
        })
        .execute();
    });
  }
}
