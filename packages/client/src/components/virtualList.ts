import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

/** The app's scrolling `<main>` (`App.tsx`). Pages scroll inside it rather
 *  than the window, so windowed lists need it as their scroll element. */
export const ScrollContainerContext = createContext<HTMLElement | null>(null);

export function useScrollContainer(): HTMLElement | null {
  return useContext(ScrollContainerContext);
}

interface ContainerVirtualizerOptions {
  count: number;
  /** Best guess per row; rows are measured after render, so this only
   *  needs to be close enough to keep the scrollbar steady. */
  estimateSize: (index: number) => number;
  getItemKey: (index: number) => string;
  overscan?: number;
}

/** Windowed rendering for a list that sits somewhere inside the app's
 *  scrolling `<main>`, below other page content. Attach `listRef` to the
 *  list's outer element (sized to `virtualizer.getTotalSize()`), render only
 *  `virtualizer.getVirtualItems()`, and offset each by
 *  `item.start - scrollMargin`. Rows are measured via
 *  `virtualizer.measureElement` + `data-index`, so heights may vary. */
export function useContainerVirtualizer({
  count,
  estimateSize,
  getItemKey,
  overscan = 10,
}: ContainerVirtualizerOptions): {
  virtualizer: Virtualizer<HTMLElement, Element>;
  listRef: RefObject<HTMLDivElement | null>;
  scrollMargin: number;
} {
  const scrollElement = useScrollContainer();
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  // The list's offset within the scroll content: content above it (headers,
  // wrapping filter chips) can change height, so re-measure when it does.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !scrollElement) return;
    const measure = () => {
      const margin =
        list.getBoundingClientRect().top -
        scrollElement.getBoundingClientRect().top +
        scrollElement.scrollTop;
      setScrollMargin((prev) => (Math.abs(prev - margin) < 1 ? prev : margin));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scrollElement);
    if (list.parentElement) observer.observe(list.parentElement);
    return () => observer.disconnect();
  }, [scrollElement]);

  const virtualizer = useVirtualizer({
    count,
    estimateSize,
    getItemKey,
    overscan,
    scrollMargin,
    getScrollElement: () => scrollElement,
  });

  return { virtualizer, listRef, scrollMargin };
}
