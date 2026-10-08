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

/** Refetches `/api/<medium>?ids=` for every media type present in `items`
 *  and upserts the results into the local card caches. Best-effort: a
 *  failed medium (offline, upstream down) is skipped and leaves its cached
 *  cards as they were. Resolves once every medium has settled. */
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
      fetchCards<GameMetadata>("/api/games", ids("game")).then((rows) =>
        upsertCards(db, rows),
      ),
    );
  }
  if (idsByType.has("movie")) {
    tasks.push(
      fetchCards<MovieMetadata>("/api/movies", ids("movie")).then((rows) =>
        upsertMovieCards(db, rows),
      ),
    );
  }
  if (idsByType.has("tv")) {
    tasks.push(
      fetchCards<TvMetadata>("/api/tv", ids("tv")).then((rows) =>
        upsertTvCards(db, rows),
      ),
    );
  }
  if (idsByType.has("book")) {
    tasks.push(
      fetchCards<BookMetadata>("/api/books", ids("book")).then((rows) =>
        upsertBookCards(db, rows),
      ),
    );
  }
  await Promise.allSettled(tasks);
}
