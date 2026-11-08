import type { LibraryItem, MediaType } from "@shelfie/shared";
import { LOG_FORMATS_BY_MEDIA } from "@shelfie/shared";

export interface ListStats {
  count: number;
  byType: Record<MediaType, number>;
  ratedCount: number;
  /** Mean of rated items; null when none are rated. */
  avgRating: number | null;
  /** Sum of hours-format progress logs (games, and books logged in hours). */
  hoursLogged: number;
  /** Every completion date across the list, so replays count again. */
  completions: number;
}

export function emptyTypeCounts(): Record<MediaType, number> {
  return { game: 0, movie: 0, tv: 0, book: 0 };
}

export function listStats(items: readonly LibraryItem[]): ListStats {
  const byType = emptyTypeCounts();
  let ratedCount = 0;
  let ratingSum = 0;
  let hoursLogged = 0;
  let completions = 0;
  for (const item of items) {
    byType[item.mediaType] += 1;
    if (item.rating != null) {
      ratedCount += 1;
      ratingSum += item.rating;
    }
    if (
      item.progressFormat === "hours" &&
      item.progressValue != null &&
      LOG_FORMATS_BY_MEDIA[item.mediaType].includes("hours")
    ) {
      hoursLogged += item.progressValue;
    }
    completions += item.completedDates.length;
  }
  return {
    count: items.length,
    byType,
    ratedCount,
    avgRating: ratedCount > 0 ? ratingSum / ratedCount : null,
    hoursLogged,
    completions,
  };
}
