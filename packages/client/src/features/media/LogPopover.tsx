import {
  FloatingArrow,
  FloatingFocusManager,
  FloatingPortal,
} from "@floating-ui/react";
import type { LibraryItem } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import type { ShelfieDatabase } from "../../db/database";
import { LogModal } from "./LogModal";
import type { LogTarget } from "./libraryActions";
import type { LogPopoverState } from "./useLogPopover";

/** Renders `LogModal`'s form content as a panel anchored to whatever
 *  trigger owns `popover` (from `useLogPopover()`), with an arrow pointing
 *  back at it — instead of a full-screen centered modal. Outside clicks and
 *  Escape close it via floating-ui's `useDismiss`. */
export function LogPopover({
  popover,
  db,
  target,
  item,
}: {
  popover: LogPopoverState;
  db: ShelfieDatabase;
  target: LogTarget;
  item: RxDocument<LibraryItem> | null;
}) {
  const {
    open,
    setOpen,
    refs,
    floatingStyles,
    context,
    arrowRef,
    getFloatingProps,
  } = popover;

  if (!open) return null;

  return (
    <FloatingPortal>
      <FloatingFocusManager context={context}>
        <div
          ref={refs.setFloating}
          style={floatingStyles}
          {...getFloatingProps()}
          className="z-50 w-80 rounded border border-divider bg-panel shadow-lg"
        >
          <FloatingArrow
            ref={arrowRef}
            context={context}
            className="fill-panel"
            strokeWidth={1}
            stroke="var(--color-divider)"
          />
          <LogModal
            db={db}
            target={target}
            item={item}
            onClose={() => setOpen(false)}
          />
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}
