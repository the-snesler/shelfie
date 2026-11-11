import {
  episodeKey,
  libraryItemDocSchema,
  tvFinishedDay,
  tvWatchState,
  type ItemStatus,
  type ReplicatedLibraryItem,
  type TvMetadata,
  type TvWatchState,
} from "@shelfie/shared";
import type { Kysely } from "kysely";
import { db as defaultDb } from "../db/index.js";
import { nextRev } from "../db/sequence.js";
import type { Database } from "../db/types.js";
import { isCardFresh } from "../metadata/freshness.js";
import { refreshCards } from "../metadata/releaseRefresh.js";
import { libraryItemDocToRow, libraryItemRowToDoc } from "../sync/row.js";
import { emitChange } from "../sync/stream.js";
import { withCollectionWriteLock } from "../sync/writeQueue.js";
import { tvMetadataCollection } from "./routes.js";

/** TMDB card fetches per pass. One `/tv/{id}` call each (~100ms throttle),
 *  so an hourly pass covers ~1,200 shows a day. */
export const TV_PROGRESS_REFRESH_LIMIT = 50;

/** The only statuses the pass moves between; paused, dropped and planned
 *  shows are the user's call. */
const TRACKED: ItemStatus[] = ["active", "finished"];

export interface TvProgressDecision {
  /** Remembered per item; the status only changes when this does. */
  stateKey: string;
  state: TvWatchState;
  /** The status (and completion dates) to write, or null to leave it. */
  patch: Pick<ReplicatedLibraryItem, "status" | "completedDates"> | null;
}

/** Latest day the watcher is known to have finished or watched anything. */
function lastWatchDay(item: ReplicatedLibraryItem): string | null {
  const days = [
    ...item.completedDates,
    ...Object.entries(item.watchedEpisodes)
      .filter(([key, day]) => day && !key.startsWith("s0e"))
      .map(([, day]) => day),
  ].sort();
  return days.at(-1) ?? null;
}

/**
 * The status the shared rule implies for a tracked show:
 * - active → finished once the season is over (completion date: the day
 *   the latest aired episode was watched);
 * - finished → active when the show is caught-up-but-airing (it was marked
 *   Watched mid-season), or behind on an episode that aired after the
 *   watcher's last known activity (new episodes). Without any known day, a
 *   finished show that is "behind" was just marked Watched without
 *   ticking episodes, so it stays put.
 */
export function decideTvStatus(
  item: ReplicatedLibraryItem,
  card: TvMetadata,
  today: string,
): TvProgressDecision | null {
  const state = tvWatchState(item.watchedEpisodes, card, today);
  const last = card.lastEpisodeToAir;
  if (!state || !last) return null;
  const stateKey = `${state}@${episodeKey(last.seasonNumber, last.episodeNumber)}`;
  let patch: TvProgressDecision["patch"] = null;
  if (item.status === "active" && state === "season-over") {
    const day = tvFinishedDay(item.watchedEpisodes, card);
    patch = {
      status: "finished",
      completedDates:
        day && !item.completedDates.includes(day)
          ? [...item.completedDates, day].sort().slice(-100)
          : item.completedDates,
    };
  } else if (item.status === "finished") {
    const since = lastWatchDay(item);
    if (
      state === "caught-up" ||
      (state === "behind" && since !== null && last.airDate > since)
    )
      patch = { status: "active", completedDates: item.completedDates };
  }
  return { stateKey, state, patch };
}

export interface TvProgressChange {
  id: string;
  name: string;
  from: ItemStatus;
  to: ItemStatus;
  state: TvWatchState;
}

export interface TvProgressOptions {
  now?: number;
  /** Limit the pass to these library item ids (e.g. a just-imported batch). */
  itemIds?: string[];
  refreshLimit?: number;
  shouldStop?: () => boolean;
}

/**
 * One bounded pass: refresh the stalest TV cards of active/finished shows,
 * apply {@link decideTvStatus}, and sync any status changes to clients.
 *
 * Edge-triggered: each item's last seen state lives in `tv_progress`, and a
 * status is only written when that state changes (a new episode airs, a
 * finale lands, the grace period lapses). A status the user picks by hand
 * therefore sticks until the show itself moves on.
 */
export async function runTvProgressPass(
  database: Kysely<Database> = defaultDb,
  {
    now = Date.now(),
    itemIds,
    refreshLimit = TV_PROGRESS_REFRESH_LIMIT,
    shouldStop = () => false,
  }: TvProgressOptions = {},
): Promise<TvProgressChange[]> {
  if (itemIds?.length === 0) return [];
  let query = database
    .selectFrom("library_items")
    .selectAll()
    .where("media_type", "=", "tv")
    .where("deleted", "=", 0)
    .where("status", "in", TRACKED);
  if (itemIds) query = query.where("id", "in", itemIds);
  const rows = await query.execute();
  const tmdbIds = [
    ...new Set(
      rows
        .map((row) => Number(row.source_id))
        .filter((id) => Number.isSafeInteger(id) && id > 0),
    ),
  ];
  if (tmdbIds.length === 0) return [];

  let cards = await tvMetadataCollection.fetchCachedCards(database, tmdbIds);
  const due = tmdbIds
    .map((id) => ({ id, fetchedAt: cards.get(id)?.fetchedAt ?? 0 }))
    .filter(({ id }) => {
      const cached = cards.get(id);
      return (
        !cached ||
        !isCardFresh(tvMetadataCollection, cached.card, cached.fetchedAt, now)
      );
    })
    .sort((a, b) => a.fetchedAt - b.fetchedAt || a.id - b.id)
    .slice(0, refreshLimit)
    .map(({ id }) => id);
  if (due.length > 0 && !shouldStop()) {
    try {
      await refreshCards(database, tvMetadataCollection, due);
      cards = await tvMetadataCollection.fetchCachedCards(database, tmdbIds);
    } catch (error) {
      // Decide from whatever is cached; stale cards catch up next pass.
      console.error(
        "[tv-progress] could not refresh TV cards from TMDB:",
        error instanceof Error ? error.message : error,
      );
    }
  }
  if (shouldStop()) return [];

  const today = new Date(now).toISOString().slice(0, 10);
  const seen = new Map(
    (
      await database
        .selectFrom("tv_progress")
        .selectAll()
        .where(
          "item_id",
          "in",
          rows.map((row) => row.id),
        )
        .execute()
    ).map((record) => [record.item_id, record.state_key]),
  );
  const pending = rows.filter((row) => {
    const card = cards.get(Number(row.source_id))?.card;
    const decision = card
      ? decideTvStatus(libraryItemRowToDoc(row), card, today)
      : null;
    return decision && seen.get(row.id) !== decision.stateKey;
  });
  if (pending.length === 0) return [];

  const changes: TvProgressChange[] = [];
  const written: ReplicatedLibraryItem[] = [];
  let latestSeq = 0;
  await withCollectionWriteLock("library_items", async () => {
    await database.transaction().execute(async (trx) => {
      for (const { id, source_id } of pending) {
        // Re-read under the lock: a client push may have landed meanwhile.
        const row = await trx
          .selectFrom("library_items")
          .selectAll()
          .where("id", "=", id)
          .executeTakeFirst();
        const card = cards.get(Number(source_id))!.card;
        if (!row || row.deleted || !TRACKED.includes(row.status as ItemStatus))
          continue;
        const current = libraryItemRowToDoc(row);
        const decision = decideTvStatus(current, card, today);
        if (!decision) continue;
        if (decision.patch) {
          const doc = libraryItemDocSchema.parse({
            ...current,
            ...decision.patch,
            updatedAt: Math.max(now, current.updatedAt + 1),
          });
          const seq = nextRev("library_items");
          const record = libraryItemDocToRow(doc, seq);
          await trx
            .insertInto("library_items")
            .values(record)
            .onConflict((oc) => oc.column("id").doUpdateSet(record))
            .execute();
          written.push(doc);
          latestSeq = seq;
          changes.push({
            id,
            name: card.name,
            from: current.status,
            to: doc.status,
            state: decision.state,
          });
        }
        await trx
          .insertInto("tv_progress")
          .values({
            item_id: id,
            state_key: decision.stateKey,
            evaluated_at: now,
          })
          .onConflict((oc) =>
            oc.column("item_id").doUpdateSet({
              state_key: decision.stateKey,
              evaluated_at: now,
            }),
          )
          .execute();
      }
    });
    if (written.length)
      emitChange("library_items", {
        documents: written,
        checkpoint: { seq: latestSeq },
      });
  });
  for (const change of changes)
    console.info(
      `[tv-progress] ${change.name} (${change.id}): ${change.from} -> ${change.to} (${change.state})`,
    );
  return changes;
}
