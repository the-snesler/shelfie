import type {
  LibraryItem,
  TvDetail as TvDetailDto,
  TvSeason,
} from "@shelfie/shared";
import { NON_FINISHED_STATUSES, STATUS_META_GROUP } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { useEffect, useMemo, useState } from "react";
import { authFetch } from "../../auth";
import type { BookCardDoc } from "../../db/bookCards";
import type { ShelfieDatabase } from "../../db/database";
import type { GameCardDoc } from "../../db/gameCards";
import type { MovieCardDoc } from "../../db/movieCards";
import { refreshCardCaches } from "../../db/refreshCards";
import type { TvCardDoc } from "../../db/tvCards";

/** Any card-cache doc a library item might have metadata for. All four
 *  share the `${mediaType}:${sourceId}` id convention, so they can live in
 *  one map keyed by `LibraryItem.id`/`doc.id`. */
export type CardMeta = GameCardDoc | MovieCardDoc | TvCardDoc | BookCardDoc;

export interface LibraryData {
  items: RxDocument<LibraryItem>[];
  cards: Map<string, CardMeta>;
  tvCatalogs: Map<string, TvSeason[]>;
}

/** Last-known library snapshot, kept outside React state so a remount (e.g.
 *  navigating away to an item's detail page and back) can render the grid on
 *  its very first paint instead of flashing empty while RxDB's subscription
 *  reconnects — required for the view transition back to Library to find a
 *  cover box to morph into, since the browser only pairs elements present
 *  when it snapshots the new DOM, not whatever arrives a tick later. */
let cachedItems: RxDocument<LibraryItem>[] = [];
let cachedCards: Map<string, CardMeta> = new Map();
let cachedTvCatalogs: Map<string, TvSeason[]> = new Map();

/** Replaces every entry under `prefix` (a media type's `"<type>:"` id
 *  namespace) with a fresh snapshot from that type's collection, leaving
 *  the other three media types' entries untouched. */
function mergeCards(
  prev: Map<string, CardMeta>,
  prefix: string,
  found: readonly CardMeta[],
): Map<string, CardMeta> {
  const next = new Map(prev);
  for (const key of next.keys()) {
    if (key.startsWith(prefix)) next.delete(key);
  }
  for (const doc of found) next.set(doc.id, doc);
  return next;
}

/** Owns every piece of reactive/async state the library grid renders from:
 *  the non-finished-item RxDB subscription, the four local card-cache
 *  subscriptions, the HTTP metadata refresh on mount, and the in-progress
 *  TV catalog fetch (for next-episode previews). Module-level caches back
 *  each piece of state so a remount reuses the last snapshot instead of
 *  flashing empty (see `cachedItems` above). */
export function useLibraryData(db: ShelfieDatabase): LibraryData {
  const [items, setItems] = useState<RxDocument<LibraryItem>[]>(cachedItems);
  const [cards, setCards] = useState<Map<string, CardMeta>>(cachedCards);
  const [tvCatalogs, setTvCatalogs] =
    useState<Map<string, TvSeason[]>>(cachedTvCatalogs);

  useEffect(() => {
    const sub = db.library_items
      .find({ selector: { status: { $in: [...NON_FINISHED_STATUSES] } } })
      .$.subscribe((found) => {
        cachedItems = [...found];
        setItems(cachedItems);
      });
    return () => sub.unsubscribe();
  }, [db]);

  useEffect(() => {
    const sub = db.game_metadata.find().$.subscribe((found) => {
      cachedCards = mergeCards(cachedCards, "game:", found);
      setCards(cachedCards);
    });
    return () => sub.unsubscribe();
  }, [db]);

  useEffect(() => {
    const sub = db.movie_metadata.find().$.subscribe((found) => {
      cachedCards = mergeCards(cachedCards, "movie:", found);
      setCards(cachedCards);
    });
    return () => sub.unsubscribe();
  }, [db]);

  useEffect(() => {
    const sub = db.tv_metadata.find().$.subscribe((found) => {
      cachedCards = mergeCards(cachedCards, "tv:", found);
      setCards(cachedCards);
    });
    return () => sub.unsubscribe();
  }, [db]);

  useEffect(() => {
    const sub = db.book_metadata.find().$.subscribe((found) => {
      cachedCards = mergeCards(cachedCards, "book:", found);
      setCards(cachedCards);
    });
    return () => sub.unsubscribe();
  }, [db]);

  const idsKey = useMemo(
    () => [...new Set(items.map((item) => item.id))].sort().join(","),
    [items],
  );

  const inProgressTvIds = useMemo(
    () =>
      [
        ...new Set(
          items
            .filter(
              (i) =>
                i.mediaType === "tv" &&
                STATUS_META_GROUP[i.status] === "in-progress",
            )
            .map((i) => i.sourceId),
        ),
      ].sort(),
    [items],
  );
  const tvCatalogKey = inProgressTvIds.join(",");

  useEffect(() => {
    void refreshCardCaches(db, items);
    // idsKey is the stable dependency; items only matter via their ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, idsKey]);

  useEffect(() => {
    let active = true;
    for (const id of inProgressTvIds) {
      if (cachedTvCatalogs.has(`tv:${id}`)) continue;
      void authFetch(`/api/tv/by-id/${encodeURIComponent(id)}`)
        .then((res) => (res.ok ? (res.json() as Promise<TvDetailDto>) : null))
        .then((meta) => {
          if (!active || !meta) return;
          cachedTvCatalogs = new Map(cachedTvCatalogs).set(
            `tv:${meta.tmdbId}`,
            meta.seasons,
          );
          setTvCatalogs(cachedTvCatalogs);
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
    // tvCatalogKey is the stable dep; inProgressTvIds is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tvCatalogKey]);

  return { items, cards, tvCatalogs };
}
