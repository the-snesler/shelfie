import { useMemo } from "react";
import { useToday } from "../media/useToday";
import type { ListContext } from "./automaticLists";

/** The clock automatic lists are evaluated against. `now` is re-read when
 *  the local day rolls over, which is all the precision "N days" rules need
 *  and keeps list membership from changing on every render. */
export function useListContext(): ListContext {
  const today = useToday();
  return useMemo(() => ({ now: Date.now(), today }), [today]);
}
