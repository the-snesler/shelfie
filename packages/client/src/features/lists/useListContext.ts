import { useMemo } from "react";
import type { CardMeta } from "../../db/cardCache";
import { useToday } from "../media/useToday";
import type { ListContext } from "./automaticLists";

/** The clock automatic lists are evaluated against. `now` is re-read when
 *  the local day rolls over, which is all the precision "N days" rules need
 *  and keeps list membership from changing on every render. */
export function useListContext(
  cards?: ReadonlyMap<string, CardMeta>,
): ListContext {
  const today = useToday();
  return useMemo(() => ({ now: Date.now(), today, cards }), [today, cards]);
}
