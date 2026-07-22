import type { LibraryItem } from "@shelfie/shared";
import type { RxDocument } from "rxdb";

export function LogNotesField({
  item,
}: {
  item: RxDocument<LibraryItem> | null;
}) {
  if (!item) return null;

  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-muted">
      Notes
      <textarea
        key={item.id}
        defaultValue={item.notes}
        onBlur={(event) => {
          if (event.target.value !== item.notes) {
            void item.incrementalPatch({
              notes: event.target.value,
              updatedAt: Date.now(),
            });
          }
        }}
        rows={4}
        className="rounded bg-bg px-3 py-2 text-ink ring-1 ring-divider"
      />
    </label>
  );
}
