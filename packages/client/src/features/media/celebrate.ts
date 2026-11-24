import confetti from "canvas-confetti";
import type { ItemStatus } from "@shelfie/shared";
import { COMPLETION_STATUSES } from "./status";

// Brass accent, warm walnut, cream, and a couple of brighter pops so the
// burst reads against both cover art and the dark chrome.
const COLORS = [
  "#e2a948",
  "#f4d38a",
  "#c8763a",
  "#fbf3e0",
  "#7fb38a",
  "#d46a6a",
];

/** Where the burst should come from: an element (centered on it) or the
 *  viewport center when there's nothing sensible to aim at. Read before
 *  the status write, since the write can move or unmount the trigger. */
export function celebrationOrigin(from?: Element | null): {
  x: number;
  y: number;
} {
  const rect = from?.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    return { x: 0.5, y: 0.6 };
  }
  return {
    x: (rect.left + rect.width / 2) / window.innerWidth,
    y: (rect.top + rect.height / 2) / window.innerHeight,
  };
}

/** True when a write moves an item into a completion status (finished /
 *  completed) — the moments worth celebrating. A repeat completion
 *  (logging a replay of something already finished) counts too, since the
 *  completion prompt treats each one as its own activity. */
export function isCompletion(
  previous: ItemStatus | null | undefined,
  next: ItemStatus,
  { repeat = false }: { repeat?: boolean } = {},
): boolean {
  if (!COMPLETION_STATUSES[next]) return false;
  return repeat || !previous || !COMPLETION_STATUSES[previous];
}

/** Fires a short confetti burst. Respects prefers-reduced-motion. */
export function celebrate(origin = celebrationOrigin()): void {
  const shared = {
    origin,
    colors: COLORS,
    disableForReducedMotion: true,
    zIndex: 1000,
  } satisfies confetti.Options;
  void confetti({
    ...shared,
    particleCount: 70,
    spread: 70,
    startVelocity: 38,
    scalar: 0.9,
  });
  void confetti({
    ...shared,
    particleCount: 40,
    spread: 120,
    startVelocity: 25,
    decay: 0.92,
    scalar: 0.75,
  });
}
