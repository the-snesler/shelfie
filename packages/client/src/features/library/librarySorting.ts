import type { LibraryItem, MediaType, MetaStatus } from "@shelfie/shared";
import { STATUS_META_GROUP } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import type { BookCardDoc } from "../../db/bookCards";
import type { GameCardDoc } from "../../db/gameCards";
import type { MovieCardDoc } from "../../db/movieCards";
import type { TvCardDoc } from "../../db/tvCards";
import { itemReleaseDate, releaseState } from "../media/release";
import type { CardMeta } from "./useLibraryData";

export type PlannedSort = "manual" | "recent" | "release" | "title" | "type";

const TYPE_ORDER: Record<MediaType, number> = {
  game: 0,
  movie: 1,
  tv: 2,
  book: 3,
};

function title(meta: CardMeta | undefined, fallback: string): string {
  return (
    (meta as GameCardDoc | MovieCardDoc | TvCardDoc | BookCardDoc | undefined)
      ?.name ?? fallback
  );
}

export function comparePlannedItems(
  a: RxDocument<LibraryItem>,
  b: RxDocument<LibraryItem>,
  sort: Exclude<PlannedSort, "manual">,
  cards: Map<string, CardMeta>,
): number {
  const aMeta = cards.get(a.id);
  const bMeta = cards.get(b.id);
  const byTitle = title(aMeta, a.sourceId).localeCompare(
    title(bMeta, b.sourceId),
    undefined,
    { sensitivity: "base" },
  );

  switch (sort) {
    case "recent":
      return b.updatedAt - a.updatedAt || byTitle || a.id.localeCompare(b.id);
    case "release": {
      // ISO days, so dates of every medium compare as strings.
      const aDate = itemReleaseDate(a, aMeta);
      const bDate = itemReleaseDate(b, bMeta);
      if (aDate == null) return bDate == null ? byTitle : 1;
      if (bDate == null) return -1;
      return bDate.localeCompare(aDate) || byTitle;
    }
    case "title":
      return byTitle || a.id.localeCompare(b.id);
    case "type":
      return TYPE_ORDER[a.mediaType] - TYPE_ORDER[b.mediaType] || byTitle;
  }
}

export function normalizeManualOrder(
  current: readonly string[],
  items: readonly RxDocument<LibraryItem>[],
): string[] {
  const ids = new Set(items.map((item) => item.id));
  const kept = current.filter((id) => ids.delete(id));
  const added = items
    .filter((item) => ids.has(item.id))
    .sort((a, b) => b.addedAt - a.addedAt || a.id.localeCompare(b.id))
    .map((item) => item.id);
  return [...kept, ...added];
}

/** A Library section: a meta-status bucket, plus "unreleased" — wishlisted
 *  titles that can't be watched/played/read yet, split out of Planned. */
export type ShelfSection = MetaStatus | "unreleased";

/** Display order, top to bottom. */
export const SHELF_SECTIONS: readonly ShelfSection[] = [
  "in-progress",
  "planned",
  "unreleased",
  "finished",
];

export function shelfSection(
  item: LibraryItem,
  meta: CardMeta | undefined,
  today: string,
): ShelfSection {
  if (
    item.status === "wishlisted" &&
    releaseState(item, meta, today).kind !== "released"
  ) {
    return "unreleased";
  }
  return STATUS_META_GROUP[item.status];
}

/** Soonest release first; dateless (TBA) titles last; then A–Z. */
export function compareUnreleasedItems(
  a: RxDocument<LibraryItem>,
  b: RxDocument<LibraryItem>,
  cards: Map<string, CardMeta>,
  today: string,
): number {
  const aMeta = cards.get(a.id);
  const bMeta = cards.get(b.id);
  const aState = releaseState(a, aMeta, today);
  const bState = releaseState(b, bMeta, today);
  const aDate = aState.kind === "upcoming" ? aState.date : null;
  const bDate = bState.kind === "upcoming" ? bState.date : null;
  const byDate =
    aDate == null
      ? bDate == null
        ? 0
        : 1
      : bDate == null
        ? -1
        : aDate.localeCompare(bDate);
  return (
    byDate ||
    title(aMeta, a.sourceId).localeCompare(
      title(bMeta, b.sourceId),
      undefined,
      {
        sensitivity: "base",
      },
    ) ||
    a.id.localeCompare(b.id)
  );
}
