import { useEffect, useState } from "react";
import { todayLocalIsoDate } from "./libraryActions";

/** The viewer's local ISO day, re-rendering at local midnight so
 *  date-derived UI (e.g. the Unreleased shelf) rolls over without a reload.
 *  Timers stall while a device sleeps, so also recheck when the tab is
 *  shown again. */
export function useToday(): string {
  const [today, setToday] = useState(todayLocalIsoDate);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const now = new Date();
      const midnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      );
      timer = setTimeout(
        () => {
          setToday(todayLocalIsoDate());
          schedule();
        },
        // A second past midnight, so the new date is unambiguous.
        midnight.getTime() - now.getTime() + 1000,
      );
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") setToday(todayLocalIsoDate());
    };
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return today;
}
