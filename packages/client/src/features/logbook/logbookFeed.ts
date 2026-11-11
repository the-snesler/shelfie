/** Logbook feed shaping: raw log entries (one per completion or watched
 *  episode) → the rows the windowed list renders. Pure, so it stays cheap to
 *  test; generic over the item so tests needn't build RxDB documents. */

interface FeedItem {
  id: string;
}

export interface EpisodeRef {
  season: number;
  episode: number;
}

/** One logged event. Entries carry no card metadata: cards are looked up per
 *  row, so a card cache update re-renders only the rows whose card changed
 *  instead of rebuilding (and re-rendering) the whole feed. */
export type LogEntry<TItem extends FeedItem> =
  | { kind: "completion"; date: string; item: TItem }
  | ({ kind: "episode"; date: string; item: TItem } & EpisodeRef);

/** What a feed row shows: a completion as-is, or every episode of one show
 *  watched on one day collapsed together (a binge day after a Trakt import
 *  can be dozens of episodes). */
export type FeedEntry<TItem extends FeedItem> =
  | { kind: "completion"; date: string; item: TItem }
  | {
      kind: "episodes";
      date: string;
      item: TItem;
      /** Sorted by season, then episode. */
      episodes: EpisodeRef[];
      label: string;
    };

/** The feed flattened into month headers and entries, so the whole logbook
 *  is one windowed list. */
export type FeedRow<TItem extends FeedItem> =
  | { kind: "month"; key: string; month: string; first: boolean }
  | { kind: "entry"; key: string; entry: FeedEntry<TItem> };

function episodeLabel({ season, episode }: EpisodeRef): string {
  return `S${season}E${episode}`;
}

/** `S1E3` for one episode, `S1E3–E7` for an unbroken run within a season,
 *  and a first–last range plus a count when there are gaps or the run
 *  crosses seasons (whether those are contiguous isn't knowable here). */
export function episodeRangeLabel(sorted: readonly EpisodeRef[]): string {
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (sorted.length === 1) return episodeLabel(first);
  const sameSeason = first.season === last.season;
  const range = `${episodeLabel(first)}–${
    sameSeason ? `E${last.episode}` : episodeLabel(last)
  }`;
  const unbroken =
    sameSeason && last.episode - first.episode + 1 === sorted.length;
  return unbroken ? range : `${range} · ${sorted.length} eps`;
}

function compareEpisodes(a: EpisodeRef, b: EpisodeRef): number {
  return a.season - b.season || a.episode - b.episode;
}

/** Collapses each show's episodes within a single day into one entry, placed
 *  where that show's first episode of the day was. Expects `entries` sorted
 *  by date (descending), so each day's entries are adjacent. */
export function groupEpisodes<TItem extends FeedItem>(
  entries: readonly LogEntry<TItem>[],
): FeedEntry<TItem>[] {
  type Group = Extract<FeedEntry<TItem>, { kind: "episodes" }>;
  const out: FeedEntry<TItem>[] = [];
  let date: string | null = null;
  let groups = new Map<string, Group>();
  for (const entry of entries) {
    if (entry.date !== date) {
      date = entry.date;
      groups = new Map();
    }
    if (entry.kind === "completion") {
      out.push(entry);
      continue;
    }
    const ref = { season: entry.season, episode: entry.episode };
    const group = groups.get(entry.item.id);
    if (group) {
      group.episodes.push(ref);
    } else {
      const created: Group = {
        kind: "episodes",
        date: entry.date,
        item: entry.item,
        episodes: [ref],
        label: "",
      };
      groups.set(entry.item.id, created);
      out.push(created);
    }
  }
  for (const entry of out) {
    if (entry.kind !== "episodes") continue;
    entry.episodes.sort(compareEpisodes);
    entry.label = episodeRangeLabel(entry.episodes);
  }
  return out;
}

/** Groups binge days, then interleaves a header at each month boundary.
 *  Keys are stable across re-renders so the virtualizer keeps measurements. */
export function feedRows<TItem extends FeedItem>(
  entries: readonly LogEntry<TItem>[],
): FeedRow<TItem>[] {
  const rows: FeedRow<TItem>[] = [];
  let month: string | null = null;
  // A title can be completed more than once on the same day.
  const seen = new Map<string, number>();
  for (const entry of groupEpisodes(entries)) {
    const entryMonth = entry.date.slice(0, 7);
    if (entryMonth !== month) {
      rows.push({
        kind: "month",
        key: `month:${entryMonth}`,
        month: entryMonth,
        first: month === null,
      });
      month = entryMonth;
    }
    const base = `${entry.kind}:${entry.item.id}:${entry.date}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    rows.push({ kind: "entry", key: n ? `${base}:${n}` : base, entry });
  }
  return rows;
}
