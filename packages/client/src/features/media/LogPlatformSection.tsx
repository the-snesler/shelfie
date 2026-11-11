import IconDeviceGamepad2 from "~icons/tabler/device-gamepad-2";
import { LogDisclosureRow } from "./LogRows";

/** Games only: a summary row naming the owned platforms that expands into
 *  the platform chips. */
export function LogPlatformSection({
  mediaType,
  platforms,
  selectedPlatforms,
  onTogglePlatform,
}: {
  mediaType: string;
  platforms: readonly string[];
  selectedPlatforms: readonly string[];
  onTogglePlatform: (platform: string) => void;
}) {
  if (mediaType !== "game" || platforms.length === 0) {
    return null;
  }

  return (
    <LogDisclosureRow
      icon={IconDeviceGamepad2}
      label="Platform"
      summary={
        selectedPlatforms.length > 0 ? (
          selectedPlatforms.join(", ")
        ) : (
          <span className="text-faint">None</span>
        )
      }
    >
      <div role="group" aria-label="Platforms" className="flex flex-wrap gap-2">
        {platforms.map((platform) => (
          <button
            key={platform}
            type="button"
            aria-pressed={selectedPlatforms.includes(platform)}
            onClick={() => onTogglePlatform(platform)}
            className={
              selectedPlatforms.includes(platform)
                ? "rounded bg-accent px-2 py-1 text-xs font-medium text-accent-ink"
                : "rounded bg-bg px-2 py-1 text-xs text-ink ring-1 ring-divider"
            }
          >
            {platform}
          </button>
        ))}
      </div>
    </LogDisclosureRow>
  );
}
