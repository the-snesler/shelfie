import type {
  BookMetadata,
  GameMetadata,
  LibraryItem,
  MediaType,
  MovieMetadata,
  TvDetail as TvDetailDto,
  TvMetadata,
  TvSeason,
} from "@shelfie/shared";
import {
  MEDIA_TYPES,
  NON_FINISHED_STATUSES,
  STATUS_META_GROUP,
} from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { useEffect, useMemo, useState } from "react";
import { authFetch } from "../../auth";
import { type BookCardDoc, upsertBookCards } from "../../db/bookCards";
import type { ShelfieDatabase } from "../../db/database";
import { type GameCardDoc, upsertCards } from "../../db/gameCards";
import { type MovieCardDoc, upsertMovieCards } from "../../db/movieCards";
import { type TvCardDoc, upsertTvCards } from "../../db/tvCards";

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

  const idsByType = useMemo(() => {
    const byType = new Map<MediaType, string[]>();
    for (const item of items) {
      const arr = byType.get(item.mediaType);
      if (arr) arr.push(item.sourceId);
      else byType.set(item.mediaType, [item.sourceId]);
    }
    const result: Partial<Record<MediaType, string>> = {};
    for (const [type, ids] of byType) {
      result[type] = [...new Set(ids)].sort().join(",");
    }
    return result;
  }, [items]);
  const idsKey = MEDIA_TYPES.map((t) => idsByType[t] ?? "").join("|");

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
    if (idsByType.game) {
      void authFetch(`/api/games?ids=${idsByType.game}`)
        .then((res) => (res.ok ? (res.json() as Promise<GameMetadata[]>) : []))
        .then((rows) => upsertCards(db, rows))
        .catch(() => {});
    }
    if (idsByType.movie) {
      void authFetch(`/api/movies?ids=${idsByType.movie}`)
        .then((res) => (res.ok ? (res.json() as Promise<MovieMetadata[]>) : []))
        .then((rows) => upsertMovieCards(db, rows))
        .catch(() => {});
    }
    if (idsByType.tv) {
      void authFetch(`/api/tv?ids=${idsByType.tv}`)
        .then((res) => (res.ok ? (res.json() as Promise<TvMetadata[]>) : []))
        .then((rows) => upsertTvCards(db, rows))
        .catch(() => {});
    }
    if (idsByType.book) {
      void authFetch(`/api/books?ids=${idsByType.book}`)
        .then((res) => (res.ok ? (res.json() as Promise<BookMetadata[]>) : []))
        .then((rows) => upsertBookCards(db, rows))
        .catch(() => {});
    }
    // idsKey is the stable dependency; idsByType is derived from it each render.
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
