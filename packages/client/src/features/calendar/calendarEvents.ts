import type { LibraryItem, TvScheduledEpisode } from "@shelfie/shared";
import type { GameCardDoc } from "../../db/gameCards";
import type { TvCardDoc } from "../../db/tvCards";
import { releaseDateFromEpoch } from "../media/libraryActions";
import type { CardMeta } from "../media/useLibraryData";

/** One thing on one calendar day. Episodes of the same show and season that
 *  air on the same day (a streaming drop) collapse into a single event. */
export type CalendarEvent<TItem extends LibraryItem = LibraryItem> =
  | { kind: "release"; date: string; item: TItem; card: CardMeta | undefined }
  | {
      kind: "episodes";
      date: string;
      item: TItem;
      card: CardMeta | undefined;
      season: number;
      /** Ascending episode numbers. */
      episodes: number[];
      /** The episode title, when exactly one episode airs. */
      name: string | null;
    }
  | {
      kind: "completion";
      date: string;
      item: TItem;
      card: CardMeta | undefined;
    };

const KIND_ORDER: Record<CalendarEvent["kind"], number> = {
  release: 0,
  episodes: 1,
  completion: 2,
};

/** "S2E3", "S2E1–8" (contiguous run), or "S2 · 5 episodes". */
export function episodeLabel(season: number, episodes: number[]): string {
  const first = episodes[0];
  const last = episodes[episodes.length - 1];
  if (episodes.length === 1) return `S${season}E${first}`;
  if (last - first === episodes.length - 1)
    return `S${season}E${first}–${last}`;
  return `S${season} · ${episodes.length} episodes`;
}

/**
 * Flattens the library into dated calendar events, sorted by day:
 *
 * - **completions** — every `completedDates` entry, any status;
 * - **game releases** — the card's IGDB `firstReleaseDate`;
 * - **TV episodes** — the server's cached schedule (`/api/tv/schedule`),
 *   topped up with each local card's `nextEpisodeToAir` so the next airing
 *   still shows offline or before the schedule request lands.
 *
 * Dropped items contribute their completion history but no releases.
 */
export function buildCalendarEvents<TItem extends LibraryItem>(
  items: readonly TItem[],
  cards: ReadonlyMap<string, CardMeta>,
  schedule: readonly TvScheduledEpisode[],
): CalendarEvent<TItem>[] {
  const events: CalendarEvent<TItem>[] = [];
  const showsById = new Map<string, TItem>();

  for (const item of items) {
    const card = cards.get(item.id);
    for (const date of item.completedDates) {
      events.push({ kind: "completion", date, item, card });
    }
    if (item.status === "dropped") continue;
    if (item.mediaType === "game") {
      const date = releaseDateFromEpoch(
        (card as GameCardDoc | undefined)?.firstReleaseDate ?? null,
      );
      if (date) events.push({ kind: "release", date, item, card });
    } else if (item.mediaType === "tv") {
      showsById.set(item.sourceId, item);
    }
  }

  // (show, day, season) -> episode number -> title
  const airings = new Map<
    string,
    { item: TItem; date: string; season: number; names: Map<number, string> }
  >();
  function addAiring(
    item: TItem,
    date: string,
    season: number,
    episode: number,
    name: string,
  ) {
    const key = `${item.id}|${date}|${season}`;
    const group = airings.get(key) ?? {
      item,
      date,
      season,
      names: new Map<number, string>(),
    };
    group.names.set(episode, name);
    airings.set(key, group);
  }

  const scheduled = new Set<string>();
  for (const ep of schedule) {
    const item = showsById.get(String(ep.tmdbId));
    if (!item) continue;
    scheduled.add(`${item.id}|s${ep.seasonNumber}e${ep.episodeNumber}`);
    addAiring(item, ep.airDate, ep.seasonNumber, ep.episodeNumber, ep.name);
  }
  for (const item of showsById.values()) {
    const next = (cards.get(item.id) as TvCardDoc | undefined)
      ?.nextEpisodeToAir;
    if (
      !next ||
      scheduled.has(`${item.id}|s${next.seasonNumber}e${next.episodeNumber}`)
    ) {
      continue;
    }
    addAiring(
      item,
      next.airDate,
      next.seasonNumber,
      next.episodeNumber,
      next.name,
    );
  }

  for (const group of airings.values()) {
    const episodes = [...group.names.keys()].sort((a, b) => a - b);
    events.push({
      kind: "episodes",
      date: group.date,
      item: group.item,
      card: cards.get(group.item.id),
      season: group.season,
      episodes,
      name:
        episodes.length === 1 ? (group.names.get(episodes[0]) ?? null) : null,
    });
  }

  return events.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      (a.card?.name ?? a.item.sourceId).localeCompare(
        b.card?.name ?? b.item.sourceId,
      ),
  );
}
