import type { LibraryItem, MediaType, MetaStatus } from "@shelfie/shared";
import { STATUS_META_GROUP } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import type { BookCardDoc } from "../../db/bookCards";
import type { GameCardDoc } from "../../db/gameCards";
import type { MovieCardDoc } from "../../db/movieCards";
import type { TvCardDoc } from "../../db/tvCards";
import { itemReleaseDate, releaseState } from "../media/release";
import { libraryProgressPercent } from "./libraryProgress";
import type { CardMeta } from "./useLibraryData";

export type PlannedSort =
  "manual" | "recent" | "release" | "excitement" | "title" | "type";

/** Every sort a list view offers. Home's Planned shelf uses a subset (plus
 *  its own "manual" order, which only makes sense for a hand-kept shelf). */
export type LibrarySort =
  | "recent"
  | "added"
  | "title"
  | "release"
  | "type"
  | "rating"
  | "excitement"
  | "completed"
  | "progress";

export type SortDirection = "asc" | "desc";

/** The direction each sort reads most naturally in: newest/highest first,
 *  except alphabetical and type order. */
export const NATURAL_DIRECTION: Record<LibrarySort, SortDirection> = {
  recent: "desc",
  added: "desc",
  title: "asc",
  release: "desc",
  type: "asc",
  rating: "desc",
  excitement: "desc",
  completed: "desc",
  progress: "desc",
};

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

/** Latest day an item was marked finished, or null when never. */
export function lastCompletedDate(item: LibraryItem): string | null {
  let latest: string | null = null;
  for (const date of item.completedDates) {
    if (latest == null || date > latest) latest = date;
  }
  return latest;
}

/** Progress used for sorting: TV episode ratio or logged percent/hours/pages
 *  against the card's length; finished titles count as complete. */
function sortProgress(item: LibraryItem, meta: CardMeta | undefined) {
  if (STATUS_META_GROUP[item.status] === "finished") {
    return item.status === "dropped" ? null : 100;
  }
  return libraryProgressPercent(item, meta);
}

function sortKey(
  item: RxDocument<LibraryItem>,
  meta: CardMeta | undefined,
  sort: Exclude<LibrarySort, "title">,
): number | string | null {
  switch (sort) {
    case "recent":
      return item.updatedAt;
    case "added":
      return item.addedAt;
    // ISO days, so dates of every medium compare as strings.
    case "release":
      return itemReleaseDate(item, meta);
    case "type":
      return TYPE_ORDER[item.mediaType];
    case "rating":
      return item.rating;
    case "excitement":
      return item.excitement;
    case "completed":
      return lastCompletedDate(item);
    case "progress":
      return sortProgress(item, meta);
  }
}

/** Sorts by `sort` in `direction`. Items with no value for the key (unrated,
 *  no excitement set, never finished, undated) always sink to the end whichever way the list
 *  runs; ties fall back to A–Z, then id, so the order is total. */
export function compareLibraryItems(
  a: RxDocument<LibraryItem>,
  b: RxDocument<LibraryItem>,
  sort: LibrarySort,
  cards: Map<string, CardMeta>,
  direction: SortDirection = NATURAL_DIRECTION[sort],
): number {
  const aMeta = cards.get(a.id);
  const bMeta = cards.get(b.id);
  const byTitle = title(aMeta, a.sourceId).localeCompare(
    title(bMeta, b.sourceId),
    undefined,
    { sensitivity: "base" },
  );
  const sign = direction === "asc" ? 1 : -1;
  if (sort === "title") return sign * byTitle || a.id.localeCompare(b.id);

  const aKey = sortKey(a, aMeta, sort);
  const bKey = sortKey(b, bMeta, sort);
  let byKey = 0;
  if (aKey == null) byKey = bKey == null ? 0 : 1;
  else if (bKey == null) byKey = -1;
  else if (aKey !== bKey) byKey = sign * (aKey < bKey ? -1 : 1);
  return byKey || byTitle || a.id.localeCompare(b.id);
}

export function comparePlannedItems(
  a: RxDocument<LibraryItem>,
  b: RxDocument<LibraryItem>,
  sort: Exclude<PlannedSort, "manual">,
  cards: Map<string, CardMeta>,
): number {
  return compareLibraryItems(a, b, sort, cards);
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

/** A Library section: a meta-status bucket, plus "unreleased" — planned
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
    STATUS_META_GROUP[item.status] === "planned" &&
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
