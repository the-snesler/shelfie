import type {
  BookMetadata,
  GameMetadata,
  LibraryItem,
  MediaType,
  MovieMetadata,
  TvMetadata,
} from "@shelfie/shared";
import { authFetch, getAuthToken } from "../auth";
import { upsertBookCards } from "./bookCards";
import type { ShelfieDatabase } from "./database";
import { upsertCards } from "./gameCards";
import { upsertMovieCards } from "./movieCards";
import { upsertTvCards } from "./tvCards";

async function fetchCards<T>(path: string, ids: string[]): Promise<T[]> {
  const res = await authFetch(`${path}?ids=${ids.join(",")}`);
  return res.ok ? ((await res.json()) as T[]) : [];
}

/** Anonymous card batches are capped at 10 ids, and every id costs one unit
 * of the 10-per-minute anonymous quota that search and detail pages share. */
const GUEST_BATCH_SIZE = 10;
const GUEST_REFRESH_LIMIT = 10;
/** Guests only refetch a card once it is a week old (the server's own TTL). */
const GUEST_CARD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** A guest card that just failed (often a 429) is not retried on every
 *  remount; screens that mount together share the same budget. */
const GUEST_RETRY_MS = 5 * 60 * 1000;
const guestAttempts = new Map<string, number>();

/** For callers that write cards from elsewhere (the bundled demo shelf):
 *  their items can render before those cards land, and a guest refresh in
 *  that gap would spend the anonymous quota refetching them. */
export function skipGuestRefresh(cardIds: readonly string[]): void {
  const now = Date.now();
  for (const id of cardIds) guestAttempts.set(id, now);
}

/** Keep URLs and upstream fan-out bounded even after a large source import.
 * Only one batch per medium runs at a time, and successful batches become
 * available immediately rather than waiting for the entire collection. */
async function refreshMedium<T>(
  path: string,
  ids: string[],
  upsert: (cards: T[]) => Promise<void>,
  batchSize: number,
): Promise<void> {
  for (let start = 0; start < ids.length; start += batchSize) {
    try {
      await upsert(
        await fetchCards<T>(path, ids.slice(start, start + batchSize)),
      );
    } catch {
      // Retain this batch's cached cards, then continue refreshing the rest.
    }
  }
}

/** Narrows a guest refresh to cards that are missing or a week old, missing
 *  first, at most `GUEST_REFRESH_LIMIT` ids in total. */
async function guestRefreshIds(
  db: ShelfieDatabase,
  idsByType: Map<MediaType, Set<string>>,
  now: number,
): Promise<Map<MediaType, Set<string>>> {
  const collections = {
    game: db.game_metadata,
    movie: db.movie_metadata,
    tv: db.tv_metadata,
    book: db.book_metadata,
  } satisfies Record<MediaType, unknown>;
  const missing: [MediaType, string][] = [];
  const stale: [MediaType, string][] = [];
  for (const [type, sourceIds] of idsByType) {
    const docIds = [...sourceIds].map((sourceId) => `${type}:${sourceId}`);
    const cached = await collections[type].findByIds(docIds).exec();
    for (const sourceId of [...sourceIds].sort()) {
      const key = `${type}:${sourceId}`;
      if ((guestAttempts.get(key) ?? 0) > now - GUEST_RETRY_MS) continue;
      const card = cached.get(key);
      if (!card) missing.push([type, sourceId]);
      // Not every card schema has a timestamp; RxDB's last-write time
      // advances on every refresh upsert.
      else if (card._data._meta.lwt < now - GUEST_CARD_TTL_MS)
        stale.push([type, sourceId]);
    }
  }
  const picked = new Map<MediaType, Set<string>>();
  for (const [type, sourceId] of [...missing, ...stale].slice(
    0,
    GUEST_REFRESH_LIMIT,
  )) {
    guestAttempts.set(`${type}:${sourceId}`, now);
    picked.set(type, (picked.get(type) ?? new Set()).add(sourceId));
  }
  return picked;
}

/** Refetches `/api/<medium>?ids=` for every media type present in `items`
 *  and upserts the results into the local card caches in batches of 100.
 *  Failed batches (offline, upstream down) retain their cached cards while
 *  other batches continue. Resolves once every medium has settled.
 *
 *  Guests (no session token) share a small anonymous quota with search, so
 *  they only fetch missing or week-old cards, ten at a time. */
export async function refreshCardCaches(
  db: ShelfieDatabase,
  items: readonly Pick<LibraryItem, "mediaType" | "sourceId">[],
): Promise<void> {
  let idsByType = new Map<MediaType, Set<string>>();
  for (const item of items) {
    const ids = idsByType.get(item.mediaType) ?? new Set<string>();
    ids.add(item.sourceId);
    idsByType.set(item.mediaType, ids);
  }
  const guest = !getAuthToken();
  if (guest) idsByType = await guestRefreshIds(db, idsByType, Date.now());
  const batchSize = guest ? GUEST_BATCH_SIZE : 100;
  const ids = (type: MediaType) => [...(idsByType.get(type) ?? [])].sort();

  const tasks: Promise<void>[] = [];
  if (idsByType.has("game")) {
    tasks.push(
      refreshMedium<GameMetadata>(
        "/api/games",
        ids("game"),
        (rows) => upsertCards(db, rows),
        batchSize,
      ),
    );
  }
  if (idsByType.has("movie")) {
    tasks.push(
      refreshMedium<MovieMetadata>(
        "/api/movies",
        ids("movie"),
        (rows) => upsertMovieCards(db, rows),
        batchSize,
      ),
    );
  }
  if (idsByType.has("tv")) {
    tasks.push(
      refreshMedium<TvMetadata>(
        "/api/tv",
        ids("tv"),
        (rows) => upsertTvCards(db, rows),
        batchSize,
      ),
    );
  }
  if (idsByType.has("book")) {
    tasks.push(
      refreshMedium<BookMetadata>(
        "/api/books",
        ids("book"),
        (rows) => upsertBookCards(db, rows),
        batchSize,
      ),
    );
  }
  await Promise.allSettled(tasks);
}
