import IconStar from "~icons/tabler/star";
import IconStarFilled from "~icons/tabler/star-filled";
import IconStarHalfFilled from "~icons/tabler/star-half-filled";

/** Read-only half-step star display for a rating (logbook, list rows) — unlike
 *  `StarRating` (detail/StarRating.tsx), which is an interactive control
 *  with a required onChange and a clear button. */
export function StaticStars({ value }: { value: number | null }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => {
        const filled = value != null && value >= i;
        const half = !filled && value != null && value >= i - 0.5;
        const Icon = filled
          ? IconStarFilled
          : half
            ? IconStarHalfFilled
            : IconStar;
        return (
          <Icon
            key={i}
            className={
              filled || half
                ? "size-3.5 text-amber-400"
                : "size-3.5 text-divider"
            }
          />
        );
      })}
    </div>
  );
}
