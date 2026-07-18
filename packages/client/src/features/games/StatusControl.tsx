import type { LibraryItem } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import IconChevronDown from "~icons/tabler/chevron-down";
import type { ShelfieDatabase } from "../../db/database";
import { LogPopover } from "./LogPopover";
import type { LogGame } from "./libraryActions";
import { newLibraryItem } from "./libraryActions";
import { STATUS_ICONS, STATUS_LABELS } from "./status";
import { useLogPopover } from "./useLogPopover";

/** Split "Add to Pile" button: primary click one-click adds a game as
 *  `backlogged`, or (once owned) opens the detailed `LogPopover` — same
 *  popover the chevron always opens, anchored to this button. */
export function StatusControl({
  db,
  game,
  item,
}: {
  db: ShelfieDatabase;
  game: LogGame;
  item: RxDocument<LibraryItem> | null | undefined;
}) {
  const popover = useLogPopover();

  if (item === undefined) {
    return (
      <button
        type="button"
        disabled
        className="rounded bg-accent px-3 py-2 text-sm text-white opacity-60"
      >
        …
      </button>
    );
  }

  const inLibrary = item !== null;
  const Icon = inLibrary ? STATUS_ICONS[item.status] : STATUS_ICONS.backlogged;
  const label = inLibrary ? STATUS_LABELS[item.status] : "Add to Pile";

  return (
    <>
      <div
        ref={popover.refs.setReference}
        {...popover.getReferenceProps()}
        className="inline-flex self-start rounded"
      >
        <button
          type="button"
          onClick={() =>
            inLibrary
              ? popover.setOpen(true)
              : void db.library_items.insert(newLibraryItem(game, "backlogged"))
          }
          className="flex items-center gap-2 rounded-l bg-accent px-3 py-2 text-sm text-white"
        >
          <Icon />
          {label}
        </button>
        <button
          type="button"
          aria-label="More log options"
          onClick={() => popover.setOpen(true)}
          className="rounded-r border-l border-white/20 bg-accent px-2 py-2 text-white"
        >
          <IconChevronDown />
        </button>
      </div>
      <LogPopover popover={popover} db={db} game={game} item={item ?? null} />
    </>
  );
}
