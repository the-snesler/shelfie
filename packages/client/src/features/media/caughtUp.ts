import type { LibraryItem } from "@shelfie/shared";
import { tvWatchState } from "@shelfie/shared";
import type { CardMeta } from "../../db/cardCache";
import type { TvCardDoc } from "../../db/tvCards";

/**
 * A show being watched with every aired episode seen and more on the way
 * (see the shared `tvWatchState`). View-only: Home tucks these into a
 * "+N caught up" tile, and the hourly server pass moves them to Watched
 * once the season ends. Unknown (no card yet) is never caught up, so the
 * show stays visible.
 */
export function isCaughtUp(
  item: Pick<LibraryItem, "mediaType" | "status" | "watchedEpisodes">,
  card: CardMeta | undefined,
  today: string,
): boolean {
  return (
    item.mediaType === "tv" &&
    item.status === "active" &&
    tvWatchState(item.watchedEpisodes, card as TvCardDoc | undefined, today) ===
      "caught-up"
  );
}
