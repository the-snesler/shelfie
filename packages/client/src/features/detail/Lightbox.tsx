import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import IconChevronLeft from "~icons/tabler/chevron-left";
import IconChevronRight from "~icons/tabler/chevron-right";
import IconX from "~icons/tabler/x";

/** Full-viewport image lightbox for the game screenshot strip on `Detail`.
 *  Portals to `document.body` so it escapes the detail page's scroll
 *  container, locks body scroll while mounted, and supports keyboard
 *  (Escape / ArrowLeft / ArrowRight) alongside click navigation. */
export function Lightbox({
  images,
  index,
  onClose,
  onIndexChange,
}: {
  images: string[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}) {
  // Mounts closed, then flips true a frame later so the opacity/scale
  // transition below actually animates from its initial state instead of
  // snapping straight to open.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "ArrowLeft") {
        onIndexChange((index - 1 + images.length) % images.length);
      } else if (event.key === "ArrowRight") {
        onIndexChange((index + 1) % images.length);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [images.length, index, onClose, onIndexChange]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 transition-opacity duration-150 ease-out"
      style={{ opacity: visible ? 1 : 0 }}
      onClick={onClose}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute right-4 top-4 rounded p-1 text-muted hover:text-ink"
      >
        <IconX className="size-6" />
      </button>
      {images.length > 1 && (
        <button
          type="button"
          aria-label="Previous image"
          onClick={(event) => {
            event.stopPropagation();
            onIndexChange((index - 1 + images.length) % images.length);
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-ink"
        >
          <IconChevronLeft className="size-8" />
        </button>
      )}
      <img
        src={images[index]}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl transition-transform duration-150 ease-out"
        style={{ transform: visible ? "scale(1)" : "scale(0.96)" }}
      />
      {images.length > 1 && (
        <button
          type="button"
          aria-label="Next image"
          onClick={(event) => {
            event.stopPropagation();
            onIndexChange((index + 1) % images.length);
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-ink"
        >
          <IconChevronRight className="size-8" />
        </button>
      )}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-sm text-ink">
        {index + 1} / {images.length}
      </div>
    </div>,
    document.body,
  );
}
