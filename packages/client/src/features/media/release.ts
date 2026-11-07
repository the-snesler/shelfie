import type { LibraryItem } from "@shelfie/shared";
import type { CardMeta } from "../../db/cardCache";
import { releaseDateFromEpoch, releaseDateFromYear } from "./libraryActions";

/** TMDB series statuses for a show that has not premiered yet. */
const UNAIRED_TV_STATUSES = new Set(["Planned", "In Production", "Pilot"]);

/**
 * Where a title stands relative to `today`:
 *
 * - `upcoming` — a known release day after today;
 * - `tba` — known to be unreleased, with no date yet (a TV show TMDB lists
 *   as planned or in production);
 * - `released` — out already, *or* no date is known. Missing metadata never
 *   marks a title unreleased, so it can't be filed away by mistake.
 */
export type ReleaseState =
  { kind: "released" } | { kind: "upcoming"; date: string } | { kind: "tba" };

/** The card's own earliest release day (ISO), ignoring which platforms the
 *  item is logged on. Matches the server's iCal feed. */
export function cardReleaseDate(card: CardMeta | undefined): string | null {
  if (!card) return null;
  if ("firstReleaseDate" in card)
    return releaseDateFromEpoch(card.firstReleaseDate);
  if ("releaseDate" in card) return card.releaseDate;
  if ("publicationDate" in card) return card.publicationDate;
  if ("numberOfEpisodes" in card)
    return card.firstAirDate ?? releaseDateFromYear(card.firstAirYear);
  return null;
}

/** The release day that matters for this item. A game logged on specific
 *  platforms uses the earliest release among those platforms, so a PC game
 *  whose console port is still coming counts as unreleased on console.
 *  Falls back to the card's first release when none of them is dated. */
export function itemReleaseDate(
  item: Pick<LibraryItem, "platforms">,
  card: CardMeta | undefined,
): string | null {
  if (card && "platformReleaseDates" in card && item.platforms.length > 0) {
    const logged = new Set(item.platforms);
    // platformReleaseDates is ascending, so the first match is the earliest.
    const match = card.platformReleaseDates?.find((release) =>
      logged.has(release.platform),
    );
    if (match) return releaseDateFromEpoch(match.date);
  }
  return cardReleaseDate(card);
}

/** `today` is the viewer's local ISO day (see `useToday`). */
export function releaseState(
  item: Pick<LibraryItem, "platforms">,
  card: CardMeta | undefined,
  today: string,
): ReleaseState {
  const date = itemReleaseDate(item, card);
  if (date)
    return date > today ? { kind: "upcoming", date } : { kind: "released" };
  if (
    card &&
    "numberOfEpisodes" in card &&
    card.status &&
    UNAIRED_TV_STATUSES.has(card.status)
  ) {
    return { kind: "tba" };
  }
  return { kind: "released" };
}

export function isUnreleased(state: ReleaseState): boolean {
  return state.kind !== "released";
}
