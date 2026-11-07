import type { MetadataCollection } from "./collection.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Flat cache lifetime for every metadata row. */
export const METADATA_TTL_MS = 7 * DAY_MS;

/** Within this many days of a release, dates slip most, so cards refresh
 *  daily instead of weekly. */
const NEAR_RELEASE_MS = 30 * DAY_MS;
const NEAR_RELEASE_TTL_MS = DAY_MS;

/**
 * True when a row's release information is likely outdated: a release day
 * has arrived since the fetch (so confirm the date held), or a release is
 * under 30 days away and the row is over a day old. Days are ISO dates,
 * compared at UTC midnight.
 */
export function releaseExpired(
  releaseDays: readonly string[],
  fetchedAt: number,
  now: number,
): boolean {
  for (const day of releaseDays) {
    const at = Date.parse(`${day}T00:00:00Z`);
    if (Number.isNaN(at)) continue;
    if (now >= at && fetchedAt < at) return true;
    if (
      at > now &&
      at - now <= NEAR_RELEASE_MS &&
      now - fetchedAt >= NEAR_RELEASE_TTL_MS
    ) {
      return true;
    }
  }
  return false;
}

/** The registrar's freshness rule: flat TTL, then the medium's own expiry
 *  hook, then release proximity. */
export function isCardFresh<TCard, TDetail extends TCard, TKey>(
  collection: MetadataCollection<TCard, TDetail, TKey>,
  card: TCard,
  fetchedAt: number,
  now: number,
): boolean {
  if (fetchedAt < now - METADATA_TTL_MS) return false;
  if (collection.isExpired?.(card, fetchedAt, now)) return false;
  return !releaseExpired(collection.releaseDays?.(card) ?? [], fetchedAt, now);
}
