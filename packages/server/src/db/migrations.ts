import type { Kysely } from "kysely";
import { sql } from "kysely";
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
  {
    id: 3,
    name: "library-item-platforms",
    async up(db) {
      await db.schema
        .alterTable("library_items")
        .addColumn("platforms", "text", (c) => c.notNull().defaultTo("[]"))
        .execute();
    },
  },
  {
    id: 4,
    name: "game-metadata-platform-release-dates",
    async up(db) {
      await db.schema
        .alterTable("game_metadata")
        .addColumn("platform_release_dates", "text", (c) =>
          c.notNull().defaultTo("[]"),
        )
        .execute();
      // game_metadata is a rebuildable IGDB cache; clear it so every row
      // re-fetches with per-platform release dates on next access.
      await db.deleteFrom("game_metadata").execute();
    },
  },
  {
    id: 5,
    name: "game-metadata-detail-fields",
    async up(db) {
      await db.schema
        .alterTable("game_metadata")
        .addColumn("storyline", "text")
        .execute();
      await db.schema
        .alterTable("game_metadata")
        .addColumn("screenshots", "text")
        .execute();
      await db.schema
        .alterTable("game_metadata")
        .addColumn("videos", "text")
        .execute();
      await db.schema
        .alterTable("game_metadata")
        .addColumn("game_modes", "text")
        .execute();
      await db.schema
        .alterTable("game_metadata")
        .addColumn("themes", "text")
        .execute();
      await db.schema
        .alterTable("game_metadata")
        .addColumn("player_perspectives", "text")
        .execute();
      await db.schema
        .alterTable("game_metadata")
        .addColumn("publisher", "text")
        .execute();
      await db.schema
        .alterTable("game_metadata")
        .addColumn("aggregated_rating", "real")
        .execute();
      await db.schema
        .alterTable("game_metadata")
        .addColumn("aggregated_rating_count", "integer")
        .execute();
      await db.schema
        .alterTable("game_metadata")
        .addColumn("rating", "real")
        .execute();
      await db.schema
        .alterTable("game_metadata")
        .addColumn("rating_count", "integer")
        .execute();
      await db.schema
        .alterTable("game_metadata")
        .addColumn("stores", "text")
        .execute();
      await db.schema
        .alterTable("game_metadata")
        .addColumn("time_to_beat", "text")
        .execute();
      await db.schema
        .alterTable("game_metadata")
        .addColumn("detail_fetched_at", "integer")
        .execute();
    },
  },
  {
    id: 6,
    name: "library-item-rating-notes-completions",
    async up(db) {
      await db.schema
        .alterTable("library_items")
        .addColumn("rating", "real")
        .execute();
      await db.schema
        .alterTable("library_items")
        .addColumn("completed_dates", "text", (c) =>
          c.notNull().defaultTo("[]"),
        )
        .execute();
      await db.schema
        .alterTable("library_items")
        .addColumn("notes", "text", (c) => c.notNull().defaultTo(""))
        .execute();
    },
  },
  {
    id: 7,
    name: "library-item-progress-format",
    async up(db) {
      await db.schema
        .alterTable("library_items")
        .addColumn("progress_format", "text", (c) =>
          c.notNull().defaultTo("percent"),
        )
        .execute();
      await db.schema
        .alterTable("library_items")
        .addColumn("progress_value", "real")
        .execute();
      // Backfill: existing percent data moves into progress_value; format stays
      // "percent" (the column default). Raw SQL because `progress` is being
      // removed from the Kysely Database type.
      await sql`UPDATE library_items SET progress_value = progress`.execute(db);
      await db.schema
        .alterTable("library_items")
        .dropColumn("progress")
        .execute();
    },
  },
  {
    id: 8,
    name: "library-item-multi-media",
    async up(db) {
      await db.schema
        .alterTable("library_items")
        .addColumn("watched_episodes", "text", (c) =>
          c.notNull().defaultTo("[]"),
        )
        .execute();
      // Rename game-centric statuses to the media-neutral canonical terms.
      // Mirrors the client's RxDB migration strategy 4 exactly, so rows a
      // client already pulled converge to identical values after both
      // migrations run. Deliberately does NOT bump seq/updated_at: this is a
      // value remap, not a user write.
      await sql`UPDATE library_items SET status = CASE status
        WHEN 'playing' THEN 'active'
        WHEN 'played' THEN 'dropped'
        WHEN 'beaten' THEN 'finished'
        ELSE status END`.execute(db);
    },
  },
  {
    id: 9,
    name: "movie-tv-book-metadata-tables",
    async up(db) {
      await db.schema
        .createTable("movie_metadata")
        .addColumn("tmdb_id", "integer", (c) => c.primaryKey())
        .addColumn("name", "text", (c) => c.notNull())
        .addColumn("poster_path", "text")
        .addColumn("genres", "text", (c) => c.notNull().defaultTo("[]"))
        .addColumn("year", "integer")
        .addColumn("director", "text")
        .addColumn("runtime", "integer")
        .addColumn("summary", "text")
        .addColumn("backdrop_path", "text")
        .addColumn("tagline", "text")
        .addColumn("certification", "text")
        .addColumn("vote_average", "real")
        .addColumn("vote_count", "integer")
        .addColumn("videos", "text")
        .addColumn("cast_members", "text")
        .addColumn("imdb_id", "text")
        .addColumn("fetched_at", "integer", (c) => c.notNull())
        .addColumn("detail_fetched_at", "integer")
        .execute();
      await db.schema
        .createTable("tv_metadata")
        .addColumn("tmdb_id", "integer", (c) => c.primaryKey())
        .addColumn("name", "text", (c) => c.notNull())
        .addColumn("poster_path", "text")
        .addColumn("genres", "text", (c) => c.notNull().defaultTo("[]"))
        .addColumn("first_air_year", "integer")
        .addColumn("status", "text")
        .addColumn("number_of_seasons", "integer", (c) =>
          c.notNull().defaultTo(0),
        )
        .addColumn("number_of_episodes", "integer", (c) =>
          c.notNull().defaultTo(0),
        )
        .addColumn("networks", "text", (c) => c.notNull().defaultTo("[]"))
        .addColumn("created_by", "text", (c) => c.notNull().defaultTo("[]"))
        .addColumn("summary", "text")
        .addColumn("backdrop_path", "text")
        .addColumn("tagline", "text")
        .addColumn("certification", "text")
        .addColumn("vote_average", "real")
        .addColumn("vote_count", "integer")
        .addColumn("videos", "text")
        .addColumn("cast_members", "text")
        .addColumn("seasons", "text")
        .addColumn("last_air_date", "text")
        .addColumn("in_production", "integer")
        .addColumn("imdb_id", "text")
        .addColumn("fetched_at", "integer", (c) => c.notNull())
        .addColumn("detail_fetched_at", "integer")
        .execute();
      await db.schema
        .createTable("book_metadata")
        .addColumn("goodreads_id", "integer", (c) => c.primaryKey())
        .addColumn("name", "text", (c) => c.notNull())
        .addColumn("cover_url", "text")
        .addColumn("authors", "text", (c) => c.notNull().defaultTo("[]"))
        .addColumn("year", "integer")
        .addColumn("page_count", "integer")
        .addColumn("description", "text")
        .addColumn("publisher", "text")
        .addColumn("publication_date", "text")
        .addColumn("isbn13", "text")
        .addColumn("series_name", "text")
        .addColumn("series_position", "text")
        .addColumn("genres", "text")
        .addColumn("avg_rating", "real")
        .addColumn("ratings_count", "integer")
        .addColumn("language", "text")
        .addColumn("fetched_at", "integer", (c) => c.notNull())
        .addColumn("detail_fetched_at", "integer")
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
