import type { MediaType } from "@shelfie/shared";
import { useSearchParams } from "react-router";

const FILTERS: readonly { type: MediaType | null; label: string }[] = [
  { type: null, label: "All" },
  { type: "game", label: "Games" },
  { type: "movie", label: "Movies" },
  { type: "tv", label: "TV" },
  { type: "book", label: "Books" },
];

/** All / Games / Movies / TV / Books chips bound to `?type=`, leaving the
 *  page's other query params alone. Counts are optional (per-type totals). */
export function MediaFilter({
  type,
  counts,
}: {
  type: MediaType | null;
  counts?: Record<MediaType, number>;
}) {
  const [, setSearchParams] = useSearchParams();
  const total = counts
    ? Object.values(counts).reduce((sum, n) => sum + n, 0)
    : null;

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Media type">
      {FILTERS.map((filter) => {
        const active = type === filter.type;
        const count = filter.type ? counts?.[filter.type] : total;
        return (
          <button
            key={filter.type ?? "all"}
            type="button"
            aria-pressed={active}
            onClick={() =>
              setSearchParams(
                (params) => {
                  const next = new URLSearchParams(params);
                  if (filter.type) next.set("type", filter.type);
                  else next.delete("type");
                  return next;
                },
                { replace: true },
              )
            }
            className={
              active
                ? "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
                : "rounded-md bg-well px-3 py-1.5 text-sm text-muted hover:text-ink"
            }
          >
            {filter.label}
            {count != null && (
              <span
                className={`ml-1.5 tabular-nums ${active ? "opacity-75" : "text-faint"}`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
