import IconStar from "~icons/tabler/star";
import IconStarFilled from "~icons/tabler/star-filled";
import IconStarHalfFilled from "~icons/tabler/star-half-filled";
import IconX from "~icons/tabler/x";
import { useState } from "react";

/** Half-step (0.5–5) star rating control; `null` renders as fully unrated. */
export function StarRating({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const display = hover ?? value;

  return (
    <div
      className="flex items-center gap-1"
      onMouseLeave={() => setHover(null)}
    >
      {[1, 2, 3, 4, 5].map((i) => {
        const filled = display != null && display >= i;
        const half = !filled && display != null && display >= i - 0.5;
        const Icon = filled
          ? IconStarFilled
          : half
            ? IconStarHalfFilled
            : IconStar;
        return (
          <div key={i} className="relative">
            <Icon
              className={filled || half ? "text-amber-400" : "text-divider"}
            />
            <button
              type="button"
              aria-label={`Rate ${i - 0.5} stars`}
              onMouseEnter={() => setHover(i - 0.5)}
              onClick={() => onChange(i - 0.5)}
              className="absolute inset-y-0 left-0 w-1/2"
            />
            <button
              type="button"
              aria-label={`Rate ${i} stars`}
              onMouseEnter={() => setHover(i)}
              onClick={() => onChange(i)}
              className="absolute inset-y-0 right-0 w-1/2"
            />
          </div>
        );
      })}
      {value !== null && (
        <button
          type="button"
          aria-label="Clear rating"
          onClick={() => onChange(null)}
          className="text-muted hover:text-ink"
        >
          <IconX />
        </button>
      )}
    </div>
  );
}
