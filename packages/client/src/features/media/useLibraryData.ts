import type { LibraryItem, MediaType } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { useEffect, useState } from "react";
import { gameImageUrl, tmdbImageUrl } from "../../images";
import type { BookCardDoc } from "../../db/bookCards";
import type { ShelfieDatabase } from "../../db/database";
import type { GameCardDoc } from "../../db/gameCards";
import type { MovieCardDoc } from "../../db/movieCards";
import type { TvCardDoc } from "../../db/tvCards";

/** Any card-cache doc a library item might have metadata for. All four
 *  share the `${mediaType}:${sourceId}` id convention, so they can live in
 *  one map keyed by `LibraryItem.id`/`doc.id` — mirrors `Library.tsx`'s
 *  own (unexported) `CardMeta` union. */
export type CardMeta = GameCardDoc | MovieCardDoc | TvCardDoc | BookCardDoc;

/** Replaces every entry under `prefix` (a media type's `"<type>:"` id
 *  namespace) with a fresh snapshot from that type's collection, leaving
 *  the other three media types' entries untouched — immutable counterpart
 *  of `Library.tsx`'s `mergeCards`. */
function replacePrefix(
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

/** Subscribes to `library_items` plus the four local-only card caches and
 *  exposes a merged, reactive view — the same data `Library.tsx` renders
 *  the grid from, minus its module-level view-transition cache (that cache
 *  exists solely so a remount can redraw synchronously for a view
 *  transition; screens without that concern, like the logbook, don't need
 *  it and should use this hook instead of duplicating subscriptions). */
export function useLibraryData(db: ShelfieDatabase): {
  items: RxDocument<LibraryItem>[];
  cards: Map<string, CardMeta>;
} {
  const [items, setItems] = useState<RxDocument<LibraryItem>[]>([]);
  const [cards, setCards] = useState<Map<string, CardMeta>>(new Map());

  useEffect(() => {
    const sub = db.library_items.find().$.subscribe((found) => {
      setItems([...found]);
    });
    return () => sub.unsubscribe();
  }, [db]);

  useEffect(() => {
    const sub = db.game_metadata.find().$.subscribe((found) => {
      setCards((prev) => replacePrefix(prev, "game:", found));
    });
    return () => sub.unsubscribe();
  }, [db]);

  useEffect(() => {
    const sub = db.movie_metadata.find().$.subscribe((found) => {
      setCards((prev) => replacePrefix(prev, "movie:", found));
    });
    return () => sub.unsubscribe();
  }, [db]);

  useEffect(() => {
    const sub = db.tv_metadata.find().$.subscribe((found) => {
      setCards((prev) => replacePrefix(prev, "tv:", found));
    });
    return () => sub.unsubscribe();
  }, [db]);

  useEffect(() => {
    const sub = db.book_metadata.find().$.subscribe((found) => {
      setCards((prev) => replacePrefix(prev, "book:", found));
    });
    return () => sub.unsubscribe();
  }, [db]);

  return { items, cards };
}

/** Best-known display name for an item, falling back to its raw source id
 *  when the card cache hasn't warmed yet. */
export function cardName(
  item: { sourceId: string },
  card: CardMeta | undefined,
): string {
  return card?.name ?? item.sourceId;
}

/** Cover image URL for a card, or null when unknown/uncached — mirrors the
 *  per-medium branches in `Library.tsx`'s `LibraryItemCard`. */
export function cardCover(
  mediaType: MediaType,
  card: CardMeta | undefined,
): string | null {
  switch (mediaType) {
    case "game": {
      const c = card as GameCardDoc | undefined;
      return c?.coverImageId
        ? gameImageUrl("t_cover_big", c.coverImageId)
        : null;
    }
    case "book": {
      const c = card as BookCardDoc | undefined;
      return c?.coverUrl ?? null;
    }
    case "movie":
    case "tv": {
      const c = card as MovieCardDoc | TvCardDoc | undefined;
      return c?.posterPath ? tmdbImageUrl(c.posterPath, "w342") : null;
    }
  }
}

/** Detail route for an item, or null when unlinkable (games need a slug
 *  from the card cache; other media route by sourceId directly). */
export function detailHref(
  item: { mediaType: MediaType; sourceId: string },
  card: CardMeta | undefined,
): string | null {
  switch (item.mediaType) {
    case "game": {
      const slug = (card as GameCardDoc | undefined)?.slug;
      return slug ? `/games/${encodeURIComponent(slug)}` : null;
    }
    case "movie":
      return `/movies/${encodeURIComponent(item.sourceId)}`;
    case "tv":
      return `/tv/${encodeURIComponent(item.sourceId)}`;
    case "book":
      return `/books/${encodeURIComponent(item.sourceId)}`;
  }
}
