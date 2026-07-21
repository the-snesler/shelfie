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
    <fieldset className="flex flex-col gap-1 text-sm font-medium text-muted">
      <legend>Platform</legend>
      <div className="flex flex-wrap gap-2">
        {platforms.map((platform) => (
          <button
            key={platform}
            type="button"
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
    </fieldset>
  );
}
