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
    setOpen,
    isMounted,
    transitionStyles,
    refs,
    floatingStyles,
    context,
    arrowRef,
    getFloatingProps,
  } = popover;

  return (
    <FloatingPortal>
      {isMounted && (
        <FloatingFocusManager context={context}>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
          >
            <div
              style={transitionStyles}
              className="w-80 rounded border border-divider bg-panel relative"
            >
              <LogModal
                db={db}
                target={target}
                item={item}
                onClose={() => setOpen(false)}
              />
              <FloatingArrow
                ref={arrowRef}
                context={context}
                className="fill-panel"
                strokeWidth={1}
                stroke="var(--color-divider)"
              />
            </div>
          </div>
        </FloatingFocusManager>
      )}
    </FloatingPortal>
  );
}
