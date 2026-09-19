import type { LibraryItem } from "@shelfie/shared";
import type { BookCardDoc } from "../../db/bookCards";
import type { GameCardDoc } from "../../db/gameCards";
import type { TvCardDoc } from "../../db/tvCards";
import type { CardMeta } from "./useLibraryData";

export function libraryProgressPercent(
  item: LibraryItem,
  meta: CardMeta | undefined,
): number | null {
  if (item.status !== "active" && item.status !== "paused") return null;

  if (item.mediaType === "tv") {
    const total = (meta as TvCardDoc | undefined)?.numberOfEpisodes ?? 0;
    if (total <= 0) return null;
    const watched = Object.keys(item.watchedEpisodes).filter(
      (key) => !key.startsWith("s0e"),
    ).length;
    return clampPercent((watched / total) * 100);
  }

  if (item.mediaType === "movie" || item.progressValue == null) return null;
  if (item.progressFormat === "percent") {
    return clampPercent(item.progressValue);
  }

  if (item.mediaType === "game" && item.progressFormat === "hours") {
    const seconds = (meta as GameCardDoc | undefined)?.timeToBeat?.normally;
    if (seconds == null || seconds <= 0) return null;
    return clampPercent((item.progressValue / (seconds / 3600)) * 100);
  }

  if (item.mediaType === "book" && item.progressFormat === "pages") {
    const pages = (meta as BookCardDoc | undefined)?.pageCount ?? 0;
    if (pages <= 0) return null;
    return clampPercent((item.progressValue / pages) * 100);
  }

  return null;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}
