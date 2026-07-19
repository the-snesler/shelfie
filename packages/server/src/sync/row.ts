import type { ReplicatedLibraryItem } from "@shelfie/shared";
import type { LibraryItemsTable } from "../db/types.js";

/** SQLite row → replication wire document, for library items. */
export function libraryItemRowToDoc(
  row: LibraryItemsTable,
): ReplicatedLibraryItem {
  return {
    id: row.id,
    mediaType: row.media_type as ReplicatedLibraryItem["mediaType"],
    sourceId: row.source_id,
    status: row.status as ReplicatedLibraryItem["status"],
    progressFormat:
      row.progress_format as ReplicatedLibraryItem["progressFormat"],
    progressValue: row.progress_value,
    addedAt: row.added_at,
    updatedAt: row.updated_at,
    platforms: JSON.parse(row.platforms) as string[],
    rating: row.rating,
    completedDates: JSON.parse(row.completed_dates) as string[],
    notes: row.notes,
    watchedEpisodes: JSON.parse(row.watched_episodes) as string[],
    _deleted: row.deleted === 1,
  };
}

/** Replication wire document → SQLite row, for library items. */
export function libraryItemDocToRow(
  doc: ReplicatedLibraryItem,
  seq: number,
): LibraryItemsTable {
  return {
    id: doc.id,
    media_type: doc.mediaType,
    source_id: doc.sourceId,
    status: doc.status,
    progress_format: doc.progressFormat,
    progress_value: doc.progressValue,
    added_at: doc.addedAt,
    updated_at: doc.updatedAt,
    platforms: JSON.stringify(doc.platforms),
    rating: doc.rating,
    completed_dates: JSON.stringify(doc.completedDates),
    notes: doc.notes,
    watched_episodes: JSON.stringify(doc.watchedEpisodes),
    seq,
    deleted: doc._deleted ? 1 : 0,
  };
}
