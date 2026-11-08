import type { LibraryItem } from "@shelfie/shared";
import type { CardMeta } from "../../db/cardCache";
import type { GameCardDoc } from "../../db/gameCards";
import type { LogTarget } from "./libraryActions";
import { itemReleaseDate } from "./release";

/** The LogPopover target for an item already in the library, built from its
 *  cached card (name falls back to the source id while the card is cold). */
export function itemLogTarget(
  item: LibraryItem,
  meta: CardMeta | undefined,
): LogTarget {
  return {
    mediaType: item.mediaType,
    sourceId: item.sourceId,
    name: meta?.name ?? item.sourceId,
    platforms:
      item.mediaType === "game"
        ? ((meta as GameCardDoc | undefined)?.platforms ?? [])
        : [],
    releaseDate: itemReleaseDate(item, meta),
  };
}
