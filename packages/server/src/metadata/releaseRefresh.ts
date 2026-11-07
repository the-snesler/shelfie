import type { MediaType } from "@shelfie/shared";
import { ITEM_STATUSES, STATUS_META_GROUP } from "@shelfie/shared";
import type { Kysely } from "kysely";
import type { Database } from "../db/types.js";
import type { MetadataCollection } from "./collection.js";
import { isCardFresh } from "./freshness.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Releases in this window around today are worth keeping warm: upcoming
 *  ones because dates move, recent ones to confirm the date held. */
const WATCH_BEFORE_MS = 60 * DAY_MS;
const WATCH_AFTER_MS = 7 * DAY_MS;

/** Upstream lookups per medium per pass. Goodreads' politeness throttle is
 *  about a second per book, so this bounds a pass to well under a minute
 *  of a shared queue that interactive requests also wait on. */
export const MAX_REFRESH_PER_MEDIUM = 25;

const PLANNED_STATUSES = ITEM_STATUSES.filter(
  (status) => STATUS_META_GROUP[status] === "planned",
);

/** One medium the worker keeps warm, with its card type erased. */
export interface WatchedMedium {
  mediaType: MediaType;
  /** Refreshes whichever of `ids` need it; returns how many were fetched. */
  refresh(
    database: Kysely<Database>,
    ids: number[],
    now: number,
  ): Promise<number>;
}

/**
 * Picks the planned items whose card is missing, or stale and either
 * dateless (unknown, or TBA) or releasing within the watch window, and
 * refetches them through the medium's normal cache-fill path. Long-released
 * titles are left to the flat TTL and the client's on-open refresh.
 */
export function watchMedium<TCard, TDetail extends TCard, TKey>(
  mediaType: MediaType,
  collection: MetadataCollection<TCard, TDetail, TKey>,
): WatchedMedium {
  return {
    mediaType,
    async refresh(database, ids, now) {
      if (ids.length === 0) return 0;
      const cached = await collection.fetchCachedCards(database, ids);
      const due: { id: number; fetchedAt: number }[] = [];
      for (const id of ids) {
        const row = cached.get(id);
        if (!row) {
          due.push({ id, fetchedAt: 0 });
          continue;
        }
        if (isCardFresh(collection, row.card, row.fetchedAt, now)) continue;
        const days = collection.releaseDays?.(row.card) ?? [];
        const watched =
          days.length === 0 ||
          days.some((day) => {
            const at = Date.parse(`${day}T00:00:00Z`);
            return at >= now - WATCH_AFTER_MS && at <= now + WATCH_BEFORE_MS;
          });
        if (watched) due.push({ id, fetchedAt: row.fetchedAt });
      }
      // Stalest first, so a backlog drains across passes.
      const batch = due
        .sort((a, b) => a.fetchedAt - b.fetchedAt || a.id - b.id)
        .slice(0, MAX_REFRESH_PER_MEDIUM)
        .map((entry) => entry.id);
      if (batch.length === 0) return 0;
      try {
        return (await collection.fetchMissingCards(database, batch)).length;
      } catch (batchError) {
        // One bad id (e.g. removed upstream) must not block the others:
        // retry individually and skip whatever still fails. If every id
        // fails, the medium itself is unreachable — report that.
        let refreshed = 0;
        let failures = 0;
        for (const id of batch) {
          try {
            refreshed += (await collection.fetchMissingCards(database, [id]))
              .length;
          } catch {
            failures += 1; // Retried on a later pass.
          }
        }
        if (failures === batch.length) throw batchError;
        return refreshed;
      }
    },
  };
}

/** One bounded pass over every medium. Returns the media that failed
 *  outright (e.g. upstream credentials missing), for logging. */
export async function runReleaseRefreshCycle(
  database: Kysely<Database>,
  media: readonly WatchedMedium[],
  now = Date.now(),
  shouldStop: () => boolean = () => false,
): Promise<MediaType[]> {
  const rows = await database
    .selectFrom("library_items")
    .select(["media_type", "source_id"])
    .where("deleted", "=", 0)
    .where("status", "in", PLANNED_STATUSES)
    .execute();
  const failed: MediaType[] = [];
  for (const medium of media) {
    if (shouldStop()) break;
    const ids = rows
      .filter((row) => row.media_type === medium.mediaType)
      .map((row) => Number(row.source_id))
      .filter((id) => Number.isInteger(id) && id > 0);
    try {
      await medium.refresh(database, ids, now);
    } catch {
      failed.push(medium.mediaType);
    }
  }
  return failed;
}
