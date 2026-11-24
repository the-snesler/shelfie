import type { LibraryItem } from "@shelfie/shared";
import { compareMoments, isInstant, momentDay } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import IconX from "~icons/tabler/x";

export function LogCompletedDates({
  item,
  onRemove,
}: {
  item: RxDocument<LibraryItem> | null;
  onRemove: (moment: string) => void;
}) {
  if (!item || item.completions.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 px-2 text-sm font-medium text-muted">
      Completed
      <div className="flex flex-wrap gap-2">
        {[...item.completions]
          .sort(compareMoments)
          .reverse()
          .map((moment) => (
            <button
              key={moment}
              type="button"
              onClick={() => onRemove(moment)}
              title={
                isInstant(moment)
                  ? `${new Date(moment).toLocaleString()} · click to remove`
                  : "Click to remove"
              }
              className="group flex items-center gap-1 rounded bg-bg px-2 py-1 text-xs text-ink ring-1 ring-divider hover:ring-accent"
            >
              {new Date(`${momentDay(moment)}T00:00:00`).toLocaleDateString(
                undefined,
                { year: "numeric", month: "short", day: "numeric" },
              )}
              <IconX className="opacity-0 group-hover:opacity-100" />
            </button>
          ))}
      </div>
    </div>
  );
}
