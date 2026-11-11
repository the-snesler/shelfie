import IconBolt from "~icons/tabler/bolt";
import IconBoltFilled from "~icons/tabler/bolt-filled";
import IconX from "~icons/tabler/x";
import { useState } from "react";
import { EXCITEMENT_LEVELS, excitementLabel } from "./status";

/** Four-step bolt meter for a planned item's excitement (1–4); `null`
 *  renders as unset. The sibling of `StarRating` (detail/StarRating.tsx):
 *  hover previews a level, each step is its own button for keyboard use,
 *  and a clear button resets to unset. The level's wording sits beside the
 *  meter, previewing the hovered level. */
export function ExcitementMeter({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const display = hover ?? value;
  const label = excitementLabel(display);

  return (
    <div className="flex min-w-0 grow items-center gap-1.5">
      <div
        className="flex shrink-0 items-center"
        onMouseLeave={() => setHover(null)}
      >
        {EXCITEMENT_LEVELS.map((level) => {
          const filled = display != null && display >= level;
          const Icon = filled ? IconBoltFilled : IconBolt;
          return (
            <button
              key={level}
              type="button"
              aria-label={`Excitement: ${excitementLabel(level)}`}
              aria-pressed={value === level}
              onMouseEnter={() => setHover(level)}
              onClick={() => onChange(level)}
              className="rounded-sm"
            >
              <Icon className={filled ? "text-accent" : "text-divider"} />
            </button>
          );
        })}
      </div>
      <span
        title={label ?? undefined}
        className={
          hover != null
            ? "truncate text-xs text-ink"
            : "truncate text-xs text-muted"
        }
      >
        {label ?? <span className="text-faint">Not set</span>}
      </span>
      {value !== null && (
        <button
          type="button"
          aria-label="Clear excitement"
          onClick={() => onChange(null)}
          className="ml-auto shrink-0 text-muted hover:text-ink"
        >
          <IconX />
        </button>
      )}
    </div>
  );
}
