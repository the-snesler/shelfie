/** Pure scheduling for the planned shelf's random pick: which cards the
 *  spotlight hops across and how long it lingers on each, ending on the
 *  winner. Kept apart from the DOM/React side so it can be tested. */

export interface Hop {
  id: string;
  /** ms to stay on this card before the next hop (or the winner reveal). */
  delay: number;
}

const FIRST_DELAY_MS = 55;
const SLOWDOWN = 1.2;
const MAX_HOPS = 12;

/**
 * The spotlight's path: `hopPool` (usually the candidates on screen) supplies
 * the warm-up hops, never landing on the same card twice in a row, and the
 * last hop is always `winnerId`. Delays grow geometrically so it decelerates
 * like a roulette wheel (~1.8s for a full run).
 */
export function rouletteHops(
  hopPool: readonly string[],
  winnerId: string,
  random: () => number = Math.random,
): Hop[] {
  const hopCount = hopPool.length > 1 ? MAX_HOPS : 1;
  const ids: string[] = [];
  for (let index = 0; index < hopCount - 1; index++) {
    const previous = ids[ids.length - 1];
    // The hop before the winner also avoids it, or the wheel would look like
    // it stalled one hop early.
    const avoidWinner = index === hopCount - 2;
    let choices = hopPool.filter(
      (id) => id !== previous && !(avoidWinner && id === winnerId),
    );
    if (!choices.length) choices = hopPool.filter((id) => id !== previous);
    ids.push(choices[Math.floor(random() * choices.length)]);
  }
  ids.push(winnerId);
  return ids.map((id, index) => ({
    id,
    delay: Math.round(FIRST_DELAY_MS * SLOWDOWN ** index),
  }));
}
