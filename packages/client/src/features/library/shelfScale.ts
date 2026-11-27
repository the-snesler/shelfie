import { useSyncExternalStore } from "react";

/** Below Tailwind's `sm` breakpoint the shelf shrinks so three covers fit a
 *  row on a phone. Keep in step with the `.shelf-rows` media query in
 *  index.css, which scales the shelf's cover-zone height by the same factor. */
const COMPACT_SHELF_QUERY = "(width < 40rem)";
const COMPACT_SHELF_SCALE = 0.8;

const query =
  typeof window === "undefined" ? null : window.matchMedia(COMPACT_SHELF_QUERY);

function subscribe(onChange: () => void) {
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

const isCompact = () => query?.matches ?? false;

/** Whether the library shelf is in its compact (phone) layout. */
export function useCompactShelf(): boolean {
  return useSyncExternalStore(subscribe, isCompact, () => false);
}

/** Multiplier for every library-shelf cover dimension: 1 on wide screens. */
export function useShelfScale(): number {
  return useCompactShelf() ? COMPACT_SHELF_SCALE : 1;
}
