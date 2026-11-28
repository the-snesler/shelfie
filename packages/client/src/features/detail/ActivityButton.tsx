import type { ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import IconHistory from "~icons/tabler/history";
import type { ActivityChanges, LibraryItem } from "@tsundo/shared";
import {
  isInstant,
  momentDay,
  momentSortKey,
  parseEpisodeKey,
} from "@tsundo/shared";
import { STATUS_LABELS } from "../media/status";
import {
  describeProgressLine,
  progressLines,
  type ProgressLine,
} from "./activityProgress";

/** A stored moment as text: the local day, plus the local time when known. */
function formatMoment(moment: string): string {
  if (!isInstant(moment)) return moment;
  const time = new Date(moment).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${momentDay(moment)} ${time}`;
}

/** `progress` is this event's derived progress line (see `progressLines`);
 *  undefined when the event has none or a later correction undid it. */
function describeChanges(
  changes: ActivityChanges,
  item: LibraryItem,
  progress: ProgressLine | undefined,
): string[] {
  const lines: string[] = [];
  if (changes.status)
    lines.push(`Marked as ${STATUS_LABELS[item.mediaType][changes.status]}`);
  if (progress) lines.push(describeProgressLine(progress));
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
  if (changes.completions)
    lines.push(
      changes.completions.length
        ? `Completion dates: ${changes.completions.map(formatMoment).join(", ")}`
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
    return `${date === null ? "Marked unwatched" : "Watched"} ${range}${date ? ` · ${formatMoment(date)}` : ""}`;
  });
}

/** One row of the timeline: a logged event, or a completion/watch that no
 *  event records (imported, or recorded before the activity log existed). */
type TimelineRow =
  | { kind: "event"; key: string; at: number; lines: string[] }
  | { kind: "moment"; key: string; moment: string; label: string };

/** Local sort key for a row: logged events by when they were recorded,
 *  unlogged moments by when they happened. */
function rowSortKey(row: TimelineRow): string {
  if (row.kind === "event")
    return momentSortKey(new Date(row.at).toISOString());
  return row.moment ? momentSortKey(row.moment) : "";
}

/** The item's activity, newest first: logged events interleaved with the
 *  completions and watches no event records. The add itself comes last. */
function activityEntries(item: LibraryItem): TimelineRow[] {
  // Each progress event carries its format at the time of the edit.
  const progress = progressLines(item.activity, item.progressFormat);
  const events: TimelineRow[] = item.activity
    .map((event) => ({
      kind: "event" as const,
      key: event.id,
      at: event.at,
      lines: describeChanges(event.changes, item, progress.get(event.id)),
    }))
    .filter(({ lines }) => lines.length > 0);
  const recordedCompletions = new Set(
    item.activity.flatMap((event) => event.changes.completions ?? []),
  );
  const recordedEpisodes = new Set(
    item.activity.flatMap((event) =>
      Object.keys(event.changes.watchedEpisodes ?? {}),
    ),
  );
  const unlogged: TimelineRow[] = [
    ...item.completions
      .filter((moment) => !recordedCompletions.has(moment))
      .map((moment, index) => ({
        kind: "moment" as const,
        key: `completion:${index}`,
        moment,
        label: "Completed",
      })),
    ...Object.entries(item.watchedEpisodes)
      .filter(([key]) => !recordedEpisodes.has(key))
      .map(([key, moment]) => ({
        kind: "moment" as const,
        key: `episode:${key}`,
        moment,
        label: `Watched ${key.toUpperCase()}`,
      })),
  ];
  // Stable sort keeps same-moment rows (a bulk episode mark) in order.
  return [...events, ...unlogged]
    .map((row, index) => ({ row, index, key: rowSortKey(row) }))
    .sort((a, b) =>
      a.key === b.key ? b.index - a.index : a.key < b.key ? 1 : -1,
    )
    .map(({ row }) => row);
}

/** Hero chip that opens the item's activity timeline in a popover. Hidden
 *  until the item is in the library, since there is nothing to show. */
export function ActivityButton({
  item,
}: {
  item: LibraryItem | null | undefined;
}) {
  if (!item) return null;
  const rows = activityEntries(item);
  const count = rows.length + 1;

  return (
    <Popover.Root>
      <Popover.Trigger className="inline-flex items-center gap-1 rounded bg-well/80 px-3 py-2 text-sm text-ink ring-1 ring-divider hover:ring-accent data-popup-open:ring-accent">
        <IconHistory className="size-4 text-muted" />
        My activity
        <span className="text-faint tabular-nums">{count}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={8}>
          <Popover.Popup className="max-h-[min(28rem,70vh)] w-[min(24rem,calc(100vw-2rem))] origin-(--transform-origin) overflow-y-auto rounded border border-divider bg-panel p-4 shadow-xl transition-[opacity,scale] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <Popover.Title className="mb-3 font-display text-base font-medium text-ink">
              My activity
            </Popover.Title>
            <ol>
              {rows.map((row) =>
                row.kind === "event" ? (
                  <TimelineEntry key={row.key} at={row.at}>
                    {row.lines.map((line, index) => (
                      <p
                        key={index}
                        className="text-sm whitespace-pre-wrap break-words text-ink"
                      >
                        {line}
                      </p>
                    ))}
                  </TimelineEntry>
                ) : (
                  <TimelineEntry
                    key={row.key}
                    {...(row.moment && isInstant(row.moment)
                      ? { at: Date.parse(row.moment) }
                      : { legacyDate: row.moment })}
                  >
                    <p className="text-sm text-ink">{row.label}</p>
                  </TimelineEntry>
                ),
              )}
              <TimelineEntry at={item.addedAt}>
                <p className="text-sm text-ink">Added to library</p>
              </TimelineEntry>
            </ol>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** One node on the activity timeline: a dot on the accent rail, its
 *  timestamp, then the event's lines. The rail segment (`before:`) runs from
 *  this dot's center to the next one's and is dropped on the last entry.
 *  Entries that only know a day (`legacyDate`) get a muted dot. */
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
