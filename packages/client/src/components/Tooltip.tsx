import {
  FloatingArrow,
  FloatingPortal,
  arrow,
  flip,
  offset,
  shift,
  useFloating,
  useTransitionStyles,
  type Placement,
} from "@floating-ui/react";
import {
  cloneElement,
  useEffect,
  useRef,
  useState,
  type ElementType,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";

interface TooltipProps {
  content: ReactNode;
  /** A single element that accepts pointer handlers — the hover target. */
  children: ReactElement<Record<string, unknown>>;
  placement?: Placement;
  delay?: number;
  /** Only open when the reference element's text is actually clipped
   *  (`scrollWidth > clientWidth`), so untruncated text gets no tooltip. */
  onlyWhenTruncated?: boolean;
}

type PointerHandler = ((event: PointerEvent<HTMLElement>) => void) | undefined;

/** Hover tooltip anchored to its child, portaled to <body> so it escapes
 *  overflow-hidden shelves and cards.
 *
 *  Tooltips sit on every row of long lists (logbook, lists, library), so the
 *  closed state is deliberately cheap: a hover timer and a ref, with no
 *  floating-ui hooks. Positioning and transitions only mount once the hover
 *  delay elapses, and unmount again after the close transition. */
export function Tooltip({
  content,
  children,
  placement = "top",
  delay = 400,
  onlyWhenTruncated = false,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  // Captured from the hovered element when the tooltip opens rather than
  // via a ref callback, which would cost every closed tooltip a re-render.
  const [reference, setReference] = useState<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const childEnter = children.props.onPointerEnter as PointerHandler;
  const childLeave = children.props.onPointerLeave as PointerHandler;

  return (
    <>
      {cloneElement(children, {
        onPointerEnter: (event: PointerEvent<HTMLElement>) => {
          childEnter?.(event);
          const el = event.currentTarget;
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => {
            if (onlyWhenTruncated && el.scrollWidth <= el.clientWidth) return;
            setReference(el);
            setMounted(true);
            setOpen(true);
          }, delay);
        },
        onPointerLeave: (event: PointerEvent<HTMLElement>) => {
          childLeave?.(event);
          window.clearTimeout(timer.current);
          setOpen(false);
        },
      })}
      {mounted && reference && (
        <TooltipFloating
          reference={reference}
          open={open}
          placement={placement}
          onExited={() => setMounted(false)}
        >
          {content}
        </TooltipFloating>
      )}
    </>
  );
}

function TooltipFloating({
  reference,
  open,
  placement,
  onExited,
  children,
}: {
  reference: HTMLElement;
  open: boolean;
  placement: Placement;
  onExited: () => void;
  children: ReactNode;
}) {
  const arrowRef = useRef<SVGSVGElement>(null);
  const { refs, floatingStyles, context, isPositioned } = useFloating({
    open,
    placement,
    elements: { reference },
    middleware: [
      offset(8),
      flip(),
      shift({ padding: 8 }),
      arrow({ element: arrowRef, padding: 8 }),
    ],
  });
  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    duration: 150,
    initial: { opacity: 0, transform: "scale(0.96)" },
    open: { opacity: 1, transform: "scale(1)" },
  });

  useEffect(() => {
    if (!isMounted) onExited();
  }, [isMounted, onExited]);

  if (!isMounted) return null;
  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        role="tooltip"
        className="pointer-events-none z-50"
      >
        <div
          style={isPositioned ? transitionStyles : { opacity: 0 }}
          className="max-w-72 break-words rounded border border-divider bg-panel px-2.5 py-1.5 text-xs leading-relaxed text-ink shadow-xl"
        >
          <FloatingArrow
            ref={arrowRef}
            context={context}
            className="fill-panel"
            stroke="var(--color-divider)"
            strokeWidth={1}
            tipRadius={1}
            width={12}
            height={6}
          />
          {children}
        </div>
      </div>
    </FloatingPortal>
  );
}

/** Single-line ellipsized text that reveals the full string in a tooltip on
 *  hover — but only when it's actually cut off. Adds `truncate` itself. */
export function TruncatedText({
  as: Tag = "span",
  className = "",
  children,
  tooltip,
}: {
  as?: ElementType;
  className?: string;
  children: ReactNode;
  /** Tooltip content; defaults to `children`. */
  tooltip?: ReactNode;
}) {
  return (
    <Tooltip content={tooltip ?? children} onlyWhenTruncated>
      <Tag className={`truncate ${className}`}>{children}</Tag>
    </Tooltip>
  );
}
