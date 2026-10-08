import {
  FloatingArrow,
  FloatingPortal,
  arrow,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useHover,
  useInteractions,
  useTransitionStyles,
  type Placement,
} from "@floating-ui/react";
import {
  cloneElement,
  useRef,
  useState,
  type ElementType,
  type ReactElement,
  type ReactNode,
} from "react";

interface TooltipProps {
  content: ReactNode;
  /** A single element that can hold a ref — the tooltip's hover target. */
  children: ReactElement<Record<string, unknown>>;
  placement?: Placement;
  delay?: number;
  /** Only open when the reference element's text is actually clipped
   *  (`scrollWidth > clientWidth`), so untruncated text gets no tooltip. */
  onlyWhenTruncated?: boolean;
}

/** Hover tooltip anchored to its child, portaled to <body> so it escapes
 *  overflow-hidden shelves and cards. */
export function Tooltip({
  content,
  children,
  placement = "top",
  delay = 400,
  onlyWhenTruncated = false,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const arrowRef = useRef<SVGSVGElement>(null);
  const referenceEl = useRef<HTMLElement | null>(null);
  const { refs, floatingStyles, context, isPositioned } = useFloating({
    open,
    onOpenChange: (next) => {
      const el = referenceEl.current;
      if (next && onlyWhenTruncated && el && el.scrollWidth <= el.clientWidth)
        return;
      setOpen(next);
    },
    placement,
    middleware: [
      offset(8),
      flip(),
      shift({ padding: 8 }),
      arrow({ element: arrowRef, padding: 8 }),
    ],
  });

  const hover = useHover(context, { delay: { open: delay, close: 0 } });
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    dismiss,
  ]);
  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    duration: 150,
    initial: { opacity: 0, transform: "scale(0.96)" },
    open: { opacity: 1, transform: "scale(1)" },
  });

  return (
    <>
      {cloneElement(children, {
        ref: (el: HTMLElement | null) => {
          referenceEl.current = el;
          refs.setReference(el);
        },
        ...getReferenceProps(),
      })}
      {isMounted && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
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
              {content}
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
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
