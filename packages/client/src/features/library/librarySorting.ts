import type { LibraryItem, MediaType } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import type { BookCardDoc } from "../../db/bookCards";
import type { GameCardDoc } from "../../db/gameCards";
import type { MovieCardDoc } from "../../db/movieCards";
import type { TvCardDoc } from "../../db/tvCards";
import {
  releaseDateFromEpoch,
  releaseDateFromYear,
} from "../media/libraryActions";
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

/** ISO day, so dates of every medium compare as strings. */
function releaseDate(meta: CardMeta | undefined): string | null {
  if (!meta) return null;
  if ("firstReleaseDate" in meta)
    return releaseDateFromEpoch(meta.firstReleaseDate);
  if ("releaseDate" in meta) return meta.releaseDate;
  if ("publicationDate" in meta) return meta.publicationDate;
  if ("firstAirYear" in meta) return releaseDateFromYear(meta.firstAirYear);
  return null;
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
      const aDate = releaseDate(aMeta);
      const bDate = releaseDate(bMeta);
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
