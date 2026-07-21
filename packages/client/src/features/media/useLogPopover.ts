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
  useTransitionStyles,
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
  isMounted: boolean;
  transitionStyles: React.CSSProperties;
  refs: ExtendedRefs<ReferenceType>;
  floatingStyles: React.CSSProperties;
  context: FloatingContext;
  arrowRef: React.RefObject<SVGSVGElement | null>;
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
  const [isOpen, setIsOpen] = useState(false);
  const arrowRef = useRef<SVGSVGElement>(null);

  const { refs, floatingStyles, context, middlewareData } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: "bottom-start",
    middleware: [
      offset(10),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          const scrollEl =
            elements.floating.querySelector<HTMLElement>("[data-log-scroll]");
          if (scrollEl) {
            scrollEl.style.maxHeight = `${Math.max(availableHeight, 160)}px`;
          }
        },
      }),
      arrow({ padding: 10, element: arrowRef }),
    ],
    whileElementsMounted: autoUpdate,
  });

  const ARROW_WIDTH = 16;
  const ARROW_HEIGHT = 14;
  const arrowX = middlewareData.arrow?.x ?? 0;
  const arrowY = middlewareData.arrow?.y ?? 0;
  const transformX = arrowX + ARROW_WIDTH / 2;
  const transformY = arrowY + ARROW_HEIGHT;

  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    initial: () => ({
      transform: "scale(0.95)",
      opacity: 0,
    }),
    common: ({ side }) => ({
      transformOrigin: {
        top: `${transformX}px calc(100% + ${ARROW_HEIGHT}px)`,
        bottom: `${transformX}px ${-ARROW_HEIGHT}px`,
        left: `calc(100% + ${ARROW_HEIGHT}px) ${transformY}px`,
        right: `${-ARROW_HEIGHT}px ${transformY}px`,
      }[side],
    }),
  });
  
  const dismiss = useDismiss(context);
  const role = useRole(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([
    dismiss,
    role,
  ]);

  return {
    open: isOpen,
    setOpen: setIsOpen,
    isMounted,
    transitionStyles,
    refs,
    floatingStyles,
    context,
    arrowRef,
    getReferenceProps,
    getFloatingProps,
  };
}
