/** Games rankable by title match + popularity. IGDB search rows satisfy this. */
export interface RankableGame {
  name: string;
  total_rating_count?: number;
  hypes?: number;
}

/** Lowercase, strip non-alphanumerics to single spaces, trim. */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Classic two-row Levenshtein edit distance. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * Title-match tier for an already-normalized query/name pair (higher = better):
 * 4 exact · 3 word-boundary prefix · 2 word-boundary contains · 1 fuzzy · 0 none.
 */
function matchTier(nq: string, nn: string): number {
  if (nq.length === 0) return 0;
  if (nn === nq) return 4;
  if (nn.startsWith(nq) && (nn.length === nq.length || nn[nq.length] === " "))
    return 3;
  if (new RegExp(`\\b${nq}\\b`).test(nn)) return 2; // nq is [a-z0-9 ] only — no regex-special chars
  const ratio = 1 - levenshtein(nq, nn) / Math.max(nq.length, nn.length);
  if (ratio >= 0.7) return 1;
  return 0;
}

/**
 * Re-ranks IGDB search candidates: title-match tier desc, then popularity
 * (total_rating_count + hypes) desc, then original index asc (stable).
 * Returns a new array; input is not mutated.
 */
export function rankSearchGames<T extends RankableGame>(
  query: string,
  games: T[],
): T[] {
  const nq = normalizeTitle(query);
  const scored = games.map((game, index) => ({
    game,
    index,
    tier: matchTier(nq, normalizeTitle(game.name)),
    popularity: (game.total_rating_count ?? 0) + (game.hypes ?? 0),
  }));
  scored.sort(
    (a, b) =>
      b.tier - a.tier || b.popularity - a.popularity || a.index - b.index,
  );
  return scored.map((s) => s.game);
}
