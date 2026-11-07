import type { CoverShape } from "@shelfie/shared";
import type { SgdbGame } from "./client.js";

/**
 * Buckets tried, in order, before falling back to IGDB's cover. `iso` and
 * `tall` are within ~6% of each other so they stand in for one another;
 * neither crops acceptably into a square window (or vice versa), where the
 * IGDB cover is no worse.
 */
export const SHAPE_FALLBACKS: Record<CoverShape, CoverShape[]> = {
  square: ["square"],
  iso: ["iso", "tall"],
  tall: ["tall", "iso"],
};

/** Case/diacritic/punctuation-insensitive title key ("Pokémon: X & Y™" → "pokemon x and y"). */
export function normalizeTitle(title: string): string {
  return title
    .replace(/[\u2122\u00ae\u00a9]/g, "") // ™ ® © (NFKD would spell out "TM")
    .replace(/['\u2018\u2019`]/g, "") // "Assassin's" ≡ "Assassins"
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function releaseYear(epochSeconds: number | null | undefined): number | null {
  return epochSeconds ? new Date(epochSeconds * 1000).getUTCFullYear() : null;
}

/**
 * Picks the SteamGridDB game for an IGDB title from autocomplete results:
 * an exact (normalized) title whose release year is within a year of IGDB's,
 * or unknown on either side. Returns null when none qualifies, so the caller
 * can try a Steam-id lookup before {@link pickUniqueTitleMatch}.
 */
export function pickYearMatch(
  candidates: SgdbGame[],
  name: string,
  firstReleaseDate: number | null,
): number | null {
  const target = normalizeTitle(name);
  const year = releaseYear(firstReleaseDate);
  const match = candidates.find((candidate) => {
    if (normalizeTitle(candidate.name) !== target) return false;
    const candidateYear = releaseYear(candidate.release_date);
    return (
      year === null ||
      candidateYear === null ||
      Math.abs(candidateYear - year) <= 1
    );
  });
  return match?.id ?? null;
}

/** Last resort: the only exact-title candidate, whatever its year (console
 *  exclusives and late PC ports often carry a far-off SteamGridDB date). */
export function pickUniqueTitleMatch(
  candidates: SgdbGame[],
  name: string,
): number | null {
  const target = normalizeTitle(name);
  const exact = candidates.filter((c) => normalizeTitle(c.name) === target);
  return exact.length === 1 ? exact[0].id : null;
}
