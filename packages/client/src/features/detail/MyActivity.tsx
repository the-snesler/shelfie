import type { ActivityChanges, LibraryItem } from "@shelfie/shared";
import { parseEpisodeKey } from "@shelfie/shared";
import { STATUS_LABELS } from "../media/status";
import { DetailSection } from "./DetailChrome";

function describeChanges(
  changes: ActivityChanges,
  item: LibraryItem,
): string[] {
  const lines: string[] = [];
  if (changes.status)
    lines.push(`Marked as ${STATUS_LABELS[item.mediaType][changes.status]}`);
  if (changes.progressValue !== undefined) {
    const format = changes.progressFormat ?? item.progressFormat;
    const suffix = { percent: "%", hours: " hours", pages: " pages" }[format];
    lines.push(
      changes.progressValue === null
        ? "Cleared progress"
        : `Logged ${changes.progressValue}${suffix}`,
    );
  }
  if (changes.progressFormat && changes.progressValue == null) {
    lines.push(`Changed progress format to ${changes.progressFormat}`);
  }
  if (changes.rating !== undefined)
    lines.push(
      changes.rating === null ? "Removed rating" : `Rated ${changes.rating}/5`,
    );
  if (changes.platforms)
    lines.push(
      changes.platforms.length
        ? `Platforms: ${changes.platforms.join(", ")}`
        : "Removed platforms",
    );
  if (changes.completedDates)
    lines.push(
      changes.completedDates.length
        ? `Completion dates: ${changes.completedDates.join(", ")}`
        : "Removed completion dates",
    );
  if (changes.notes !== undefined)
    lines.push(changes.notes ? `Notes: ${changes.notes}` : "Cleared notes");
  for (const [key, date] of Object.entries(changes.watchedEpisodes ?? {})) {
    const { season, episode } = parseEpisodeKey(key);
    lines.push(
      `${date === null ? "Marked unwatched" : "Watched"} S${season}E${episode}${date ? ` · ${date}` : ""}`,
    );
  }
  return lines;
}

export function MyActivity({ item }: { item: LibraryItem | null | undefined }) {
  if (item === undefined) return null;
  if (!item)
    return (
      <DetailSection title="My activity">
        <p className="text-sm text-muted">
          Add this item to your library to start logging activity.
        </p>
      </DetailSection>
    );

  // Each progress event carries its format at the time of the edit.
  const events = [...item.activity].reverse();
  const recordedDates = new Set(
    item.activity.flatMap((event) => event.changes.completedDates ?? []),
  );
  const recordedEpisodes = new Set(
    item.activity.flatMap((event) =>
      Object.keys(event.changes.watchedEpisodes ?? {}),
    ),
  );
  const legacy = [
    ...item.completedDates
      .filter((date) => !recordedDates.has(date))
      .map((date) => ({ date, label: "Completed" })),
    ...Object.entries(item.watchedEpisodes)
      .filter(([key]) => !recordedEpisodes.has(key))
      .map(([key, date]) => ({ date, label: `Watched ${key.toUpperCase()}` })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <DetailSection title="My activity">
      <ol className="max-h-96 overflow-y-auto divide-y divide-divider rounded-xl border border-divider bg-panel/70 px-4">
        {events.map((event) => (
          <li key={event.id} className="flex flex-col gap-1.5 py-3">
            <time
              dateTime={new Date(event.at).toISOString()}
              className="text-xs text-muted"
            >
              {new Date(event.at).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "medium",
              })}
            </time>
            {describeChanges(event.changes, item).map((line, index) => (
              <p
                key={index}
                className="text-sm whitespace-pre-wrap break-words text-ink"
              >
                {line}
              </p>
            ))}
          </li>
        ))}
        {legacy.map(({ date, label }, index) => (
          <li key={`legacy:${index}`} className="flex flex-col gap-1 py-3">
            <span className="text-xs text-muted">
              {date || "Date unknown"} · Time unknown
            </span>
            <p className="text-sm text-ink">{label}</p>
          </li>
        ))}
        <li className="flex flex-col gap-1 py-3">
          <time
            dateTime={new Date(item.addedAt).toISOString()}
            className="text-xs text-muted"
          >
            {new Date(item.addedAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "medium",
            })}
          </time>
          <p className="text-sm text-ink">Added to library</p>
        </li>
      </ol>
    </DetailSection>
  );
}
