import type { LibraryItem } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import IconNotes from "~icons/tabler/notes";
import { LogDisclosureRow } from "./LogRows";

/** Notes summary row (one-line preview) that expands into the textarea.
 *  The textarea still commits on blur, so collapsing the row saves it. */
export function LogNotesField({
  item,
}: {
  item: RxDocument<LibraryItem> | null;
}) {
  if (!item) return null;

  const preview = item.notes.replace(/\s+/g, " ").trim();

  return (
    <LogDisclosureRow
      icon={IconNotes}
      label="Notes"
      summary={preview || <span className="text-faint">Add a note…</span>}
    >
      <textarea
        key={item.id}
        aria-label="Notes"
        autoFocus
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
        className="w-full rounded bg-bg px-3 py-2 text-sm text-ink ring-1 ring-divider"
      />
    </LogDisclosureRow>
  );
}
