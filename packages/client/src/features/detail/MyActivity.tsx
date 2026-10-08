import type { ReactNode } from "react";
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
  lines.push(...describeEpisodes(changes.watchedEpisodes ?? {}));
  return lines;
}

/** Collapses an episode change set into one line per run of consecutive
 *  episodes sharing a season and watched date, so a bulk mark reads as
 *  "Watched S5E1–S5E37" rather than 37 lines. */
function describeEpisodes(
  episodes: NonNullable<ActivityChanges["watchedEpisodes"]>,
): string[] {
  const sorted = Object.entries(episodes)
    .map(([key, date]) => ({ ...parseEpisodeKey(key), date }))
    .sort((a, b) => a.season - b.season || a.episode - b.episode);
  const runs: {
    season: number;
    first: number;
    last: number;
    date: string | null;
  }[] = [];
  for (const { season, episode, date } of sorted) {
    const run = runs.at(-1);
    if (
      run &&
      run.season === season &&
      run.date === date &&
      run.last + 1 === episode
    ) {
      run.last = episode;
    } else {
      runs.push({ season, first: episode, last: episode, date });
    }
  }
  return runs.map(({ season, first, last, date }) => {
    const range =
      first === last
        ? `S${season}E${first}`
        : `S${season}E${first}–S${season}E${last}`;
    return `${date === null ? "Marked unwatched" : "Watched"} ${range}${date ? ` · ${date}` : ""}`;
  });
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
      <ol className="max-h-96 overflow-y-auto p-1">
        {events.map((event) => (
          <TimelineEntry key={event.id} at={event.at}>
            {describeChanges(event.changes, item).map((line, index) => (
              <p
                key={index}
                className="text-sm whitespace-pre-wrap break-words text-ink"
              >
                {line}
              </p>
            ))}
          </TimelineEntry>
        ))}
        {legacy.map(({ date, label }, index) => (
          <TimelineEntry key={`legacy:${index}`} legacyDate={date}>
            <p className="text-sm text-ink">{label}</p>
          </TimelineEntry>
        ))}
        <TimelineEntry at={item.addedAt}>
          <p className="text-sm text-ink">Added to library</p>
        </TimelineEntry>
      </ol>
    </DetailSection>
  );
}

/** One node on the activity timeline: a dot on the accent rail, its
 *  timestamp, then the event's lines. The rail segment (`before:`) runs from
 *  this dot's center to the next one's and is dropped on the last entry.
 *  Legacy entries (`legacyDate`) only know a day, so they get a muted dot. */
function TimelineEntry({
  at,
  legacyDate,
  children,
}: {
  at?: number;
  legacyDate?: string;
  children: ReactNode;
}) {
  return (
    <li className="relative flex flex-col gap-1.5 pb-5 pl-7 before:absolute before:top-2 before:-bottom-2 before:left-[5px] before:w-0.5 before:rounded-full before:bg-accent/30 last:pb-0 last:before:hidden">
      <span
        aria-hidden
        className={`absolute top-0.5 left-0 size-3 rounded-full ${
          at === undefined ? "bg-faint" : "bg-accent ring-4 ring-accent/15"
        }`}
      />
      {at === undefined ? (
        <span className="text-xs text-muted">
          {legacyDate || "Date unknown"} · Time unknown
        </span>
      ) : (
        <time
          dateTime={new Date(at).toISOString()}
          className="text-xs text-muted"
        >
          {new Date(at).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "medium",
          })}
        </time>
      )}
      {children}
    </li>
  );
}
