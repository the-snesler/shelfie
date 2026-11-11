import IconBolt from "~icons/tabler/bolt";
import IconBoltFilled from "~icons/tabler/bolt-filled";
import { EXCITEMENT_LEVELS, excitementLabel } from "../features/media/status";

/** Read-only excitement meter (list rows) — the bolt counterpart of
 *  `StaticStars`; the interactive control is `media/ExcitementMeter.tsx`. */
export function StaticBolts({ value }: { value: number }) {
  const label = `Excitement: ${excitementLabel(value) ?? "not set"}`;
  return (
    <div
      className="flex items-center gap-0.5"
      role="img"
      aria-label={label}
      title={label}
    >
      {EXCITEMENT_LEVELS.map((level) => {
        const Icon = value >= level ? IconBoltFilled : IconBolt;
        return (
          <Icon
            key={level}
            className={
              value >= level ? "size-3.5 text-accent" : "size-3.5 text-divider"
            }
          />
        );
      })}
    </div>
  );
}
