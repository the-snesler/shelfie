import type { LibraryItem } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { useEffect, useState } from "react";
import type { ShelfieDatabase } from "../../db/database";
import { authFetch } from "../../auth";

export type DetailFetchState<TMeta> =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; meta: TMeta };

export interface UseDetailFetchOptions<TMeta> {
  db: ShelfieDatabase;
  /** Full request path, e.g. `/api/movies/by-id/42`. Re-fetches whenever
   *  this string changes. */
  url: string;
  /** Derives the `library_items` primary key (e.g. `movie:42`) from the
   *  loaded metadata, used to key the RxDB subscription below. */
  libraryItemId: (meta: TMeta) => string;
  /** Card-tier upsert for the loaded metadata, fired once on success so the
   *  library/search caches stay warm without waiting for a resync. */
  upsertCards: (db: ShelfieDatabase, cards: TMeta[]) => unknown;
}

export interface UseDetailFetchResult<TMeta> {
  metaState: DetailFetchState<TMeta>;
  item: RxDocument<LibraryItem> | null | undefined;
}

/** Fetches a detail screen's metadata and subscribes to the matching
 *  `library_items` document once that metadata identifies it. Shared by all
 *  four detail screens (game/movie/tv/book) — a single terminal `"error"`
 *  state covers both 404s and hard failures, since every screen renders
 *  every terminal failure as its own "<Thing> not found". */
export function useDetailFetch<TMeta>({
  db,
  url,
  libraryItemId,
  upsertCards,
}: UseDetailFetchOptions<TMeta>): UseDetailFetchResult<TMeta> {
  const [metaState, setMetaState] = useState<DetailFetchState<TMeta>>({
    status: "loading",
  });
  const [item, setItem] = useState<RxDocument<LibraryItem> | null | undefined>(
    undefined,
  );

  useEffect(() => {
    setMetaState({ status: "loading" });
    let active = true;
    void authFetch(url)
      .then(async (res) => {
        if (!active) return;
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
        const meta = (await res.json()) as TMeta;
        setMetaState({ status: "loaded", meta });
        void upsertCards(db, [meta]);
      })
      .catch(() => {
        if (active) setMetaState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [db, url]);

  const itemId =
    metaState.status === "loaded" ? libraryItemId(metaState.meta) : null;
  useEffect(() => {
    if (itemId === null) {
      setItem(undefined);
      return;
    }
    const sub = db.library_items.findOne(itemId).$.subscribe((doc) => {
      setItem(doc ?? null);
    });
    return () => sub.unsubscribe();
  }, [db, itemId]);

  return { metaState, item };
}
