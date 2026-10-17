import type {
  BookMetadata,
  GameMetadata,
  LibraryItem,
  MediaType,
  MovieMetadata,
  TvMetadata,
} from "@shelfie/shared";
import { authFetch } from "../auth";
import { upsertBookCards } from "./bookCards";
import type { ShelfieDatabase } from "./database";
import { upsertCards } from "./gameCards";
import { upsertMovieCards } from "./movieCards";
import { upsertTvCards } from "./tvCards";

async function fetchCards<T>(path: string, ids: string[]): Promise<T[]> {
  const res = await authFetch(`${path}?ids=${ids.join(",")}`);
  return res.ok ? ((await res.json()) as T[]) : [];
}

/** Keep URLs and upstream fan-out bounded even after a large source import.
 * Only one batch per medium runs at a time, and successful batches become
 * available immediately rather than waiting for the entire collection. */
async function refreshMedium<T>(
  path: string,
  ids: string[],
  upsert: (cards: T[]) => Promise<void>,
): Promise<void> {
  for (let start = 0; start < ids.length; start += 100) {
    try {
      await upsert(await fetchCards<T>(path, ids.slice(start, start + 100)));
    } catch {
      // Retain this batch's cached cards, then continue refreshing the rest.
    }
  }
}

/** Refetches `/api/<medium>?ids=` for every media type present in `items`
 *  and upserts the results into the local card caches in batches of 100.
 *  Failed batches (offline, upstream down) retain their cached cards while
 *  other batches continue. Resolves once every medium has settled. */
export async function refreshCardCaches(
  db: ShelfieDatabase,
  items: readonly Pick<LibraryItem, "mediaType" | "sourceId">[],
): Promise<void> {
  const idsByType = new Map<MediaType, Set<string>>();
  for (const item of items) {
    const ids = idsByType.get(item.mediaType) ?? new Set<string>();
    ids.add(item.sourceId);
    idsByType.set(item.mediaType, ids);
  }
  const ids = (type: MediaType) => [...(idsByType.get(type) ?? [])].sort();

  const tasks: Promise<void>[] = [];
  if (idsByType.has("game")) {
    tasks.push(
      refreshMedium<GameMetadata>("/api/games", ids("game"), (rows) =>
        upsertCards(db, rows),
      ),
    );
  }
  if (idsByType.has("movie")) {
    tasks.push(
      refreshMedium<MovieMetadata>("/api/movies", ids("movie"), (rows) =>
        upsertMovieCards(db, rows),
      ),
    );
  }
  if (idsByType.has("tv")) {
    tasks.push(
      refreshMedium<TvMetadata>("/api/tv", ids("tv"), (rows) =>
        upsertTvCards(db, rows),
      ),
    );
  }
  if (idsByType.has("book")) {
    tasks.push(
      refreshMedium<BookMetadata>("/api/books", ids("book"), (rows) =>
        upsertBookCards(db, rows),
      ),
    );
  }
  await Promise.allSettled(tasks);
}
