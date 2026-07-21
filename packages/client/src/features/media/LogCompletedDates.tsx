import type { LibraryItem } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import IconX from "~icons/tabler/x";

export function LogCompletedDates({
  item,
  onRemove,
}: {
  item: RxDocument<LibraryItem> | null;
  onRemove: (date: string) => void;
}) {
  if (!item || item.completedDates.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 text-sm font-medium text-muted">
      Completed
      <div className="flex flex-wrap gap-2">
        {[...item.completedDates]
          .sort()
          .reverse()
          .map((date) => (
            <button
              key={date}
              type="button"
              onClick={() => onRemove(date)}
              title="Click to remove"
              className="group flex items-center gap-1 rounded bg-bg px-2 py-1 text-xs text-ink ring-1 ring-divider hover:ring-accent"
            >
              {new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
              <IconX className="opacity-0 group-hover:opacity-100" />
            </button>
          ))}
      </div>
    </div>
  );
}
