import {
  arrow,
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import type {
  ExtendedRefs,
  FloatingContext,
  ReferenceType,
  UseInteractionsReturn,
} from "@floating-ui/react";
import { useRef, useState } from "react";

/**
 * Everything a `LogPopover` needs to render as an anchored panel, plus the
 * `open` state and reference wiring its trigger needs. Returned by
 * `useLogPopover()`; pass it straight through to `<LogPopover popover={...} />`.
 */
export interface LogPopoverState {
  open: boolean;
  setOpen: (open: boolean) => void;
  refs: ExtendedRefs<ReferenceType>;
  floatingStyles: React.CSSProperties;
  context: FloatingContext;
  arrowRef: React.RefObject<SVGSVGElement>;
  getReferenceProps: UseInteractionsReturn["getReferenceProps"];
  getFloatingProps: UseInteractionsReturn["getFloatingProps"];
}

/**
 * Floating-ui wiring shared by every trigger that opens a `LogPopover`
 * (the Detail page's split status button, a library card's `+` button, …).
 * Each caller owns its own reference element — attach `refs.setReference`
 * (and, for full keyboard/aria support, `getReferenceProps()`) to the
 * trigger — and passes the whole returned object straight through to
 * `<LogPopover popover={...} />`, which renders the anchored panel.
 */
export function useLogPopover(): LogPopoverState {
  const [open, setOpen] = useState(false);
  const arrowRef = useRef<SVGSVGElement>(null);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "bottom-start",
    middleware: [
      offset(10),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          const scrollEl = elements.floating.querySelector<HTMLElement>(
            "[data-log-scroll]",
          );
          if (scrollEl) {
            scrollEl.style.maxHeight = `${Math.max(availableHeight, 160)}px`;
          }
        },
      }),
      arrow({ element: arrowRef }),
    ],
    whileElementsMounted: autoUpdate,
  });

  const dismiss = useDismiss(context);
  const role = useRole(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([
    dismiss,
    role,
  ]);

  return {
    open,
    setOpen,
    refs,
    floatingStyles,
    context,
    arrowRef,
    getReferenceProps,
    getFloatingProps,
  };
}
