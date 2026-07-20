import {
  libraryItemDocSchema,
  type ReplicatedLibraryItem,
} from "@shelfie/shared";
import { db } from "../db/index.js";
import type { SyncCollection } from "./collection.js";
import { libraryItemDocToRow, libraryItemRowToDoc } from "./row.js";

/** The library_items collection wired into the generic pull/push orchestration. */
export const libraryItemsSync: SyncCollection<ReplicatedLibraryItem> = {
  name: "library_items",

  parse(input) {
    return libraryItemDocSchema.parse(input);
  },

  async fetchSince(sinceSeq, limit) {
    const rows = await db
      .selectFrom("library_items")
      .selectAll()
      .where("seq", ">", sinceSeq)
      .orderBy("seq", "asc")
      .limit(limit)
      .execute();
    return rows.map((row) => ({ doc: libraryItemRowToDoc(row), seq: row.seq }));
  },

  async fetchById(id) {
    const existing = await db
      .selectFrom("library_items")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return existing ? libraryItemRowToDoc(existing) : null;
  },

  async upsert(doc, seq) {
    const row = libraryItemDocToRow(doc, seq);
    await db
      .insertInto("library_items")
      .values(row)
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({
          media_type: row.media_type,
          source_id: row.source_id,
          status: row.status,
          progress_format: row.progress_format,
          progress_value: row.progress_value,
          added_at: row.added_at,
          updated_at: row.updated_at,
          platforms: row.platforms,
          rating: row.rating,
          completed_dates: row.completed_dates,
          notes: row.notes,
          watched_episodes: row.watched_episodes,
          seq: row.seq,
          deleted: row.deleted,
        }),
      )
      .execute();
  },
};
