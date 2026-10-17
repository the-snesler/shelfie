import type { TvAiring, TvSeason } from "@shelfie/shared";
import { sql, type Kysely } from "kysely";
import type { Database } from "../db/types.js";
import { scheduleForShow } from "../tv/schedule.js";

export interface CalendarEntry {
  /** Identity excludes the release date so calendar clients update reschedules. */
  key: string;
  date: string;
  title: string;
  description: string;
  kind: "release" | "episode" | "completion";
  updatedAt: number;
}

export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Reads only owned items and cached metadata. Never fetches an upstream API. */
export async function readCalendarEntries(
  database: Kysely<Database>,
  from = "0001-01-01",
  to = "9999-12-30",
): Promise<CalendarEntry[]> {
  const items = await database
    .selectFrom("library_items")
    .selectAll()
    .where("deleted", "=", 0)
    .execute();
  if (items.length === 0) return [];

  // Subqueries keep these cache reads scoped to the collection, including large
  // search caches containing titles the owner never added.
  const ownedIds = (medium: string) =>
    database
      .selectFrom("library_items")
      .select(sql<number>`CAST(source_id AS INTEGER)`.as("source_id"))
      .where("media_type", "=", medium)
      .where("deleted", "=", 0);
  const [games, movies, books, shows] = await Promise.all([
    database
      .selectFrom("game_metadata")
      .selectAll()
      .where("igdb_id", "in", ownedIds("game"))
      .execute(),
    database
      .selectFrom("movie_metadata")
      .selectAll()
      .where("tmdb_id", "in", ownedIds("movie"))
      .execute(),
    database
      .selectFrom("book_metadata")
      .selectAll()
      .where("goodreads_id", "in", ownedIds("book"))
      .execute(),
    database
      .selectFrom("tv_metadata")
      .selectAll()
      .where("tmdb_id", "in", ownedIds("tv"))
      .execute(),
  ]);
  const gameById = new Map(games.map((row) => [String(row.igdb_id), row]));
  const movieById = new Map(movies.map((row) => [String(row.tmdb_id), row]));
  const bookById = new Map(books.map((row) => [String(row.goodreads_id), row]));
  const showById = new Map(shows.map((row) => [String(row.tmdb_id), row]));
  const entries: CalendarEntry[] = [];
  for (const item of items) {
    const game =
      item.media_type === "game" ? gameById.get(item.source_id) : undefined;
    const movie =
      item.media_type === "movie" ? movieById.get(item.source_id) : undefined;
    const book =
      item.media_type === "book" ? bookById.get(item.source_id) : undefined;
    const show =
      item.media_type === "tv" ? showById.get(item.source_id) : undefined;
    const name =
      (game ?? movie ?? book ?? show)?.name ??
      `${item.media_type} ${item.source_id}`;
    const add = (entry: CalendarEntry) => {
      if (isCalendarDay(entry.date) && entry.date >= from && entry.date <= to)
        entries.push(entry);
    };
    const dates = JSON.parse(item.completed_dates) as string[];
    for (const date of new Set(dates)) {
      add({
        key: `${item.id}:completed:${date}`,
        date,
        title: `Completed: ${name}`,
        description: "Completed in Shelfie",
        kind: "completion",
        updatedAt: item.updated_at,
      });
    }
    if (item.status === "dropped") continue;
    const date =
      game?.first_release_date != null
        ? new Date(game.first_release_date * 1000).toISOString().slice(0, 10)
        : (movie?.release_date ?? book?.publication_date);
    if (date)
      add({
        key: `${item.id}:release`,
        date,
        title: name,
        description: `${item.media_type} release`,
        kind: "release",
        updatedAt: Math.max(
          item.updated_at,
          (game ?? movie ?? book)?.fetched_at ?? 0,
        ),
      });
    if (!show) continue;
    const episodes = scheduleForShow(
      show.tmdb_id,
      JSON.parse(show.seasons ?? "[]") as TvSeason[],
      JSON.parse(show.next_episode ?? "null") as TvAiring | null,
      from,
      to,
    );
    for (const episode of episodes) {
      add({
        key: `${item.id}:s${episode.seasonNumber}e${episode.episodeNumber}`,
        date: episode.airDate,
        title: `${name} — S${episode.seasonNumber}E${episode.episodeNumber}`,
        description: episode.name,
        kind: "episode",
        updatedAt: Math.max(
          item.updated_at,
          show.fetched_at,
          show.detail_fetched_at ?? 0,
        ),
      });
    }
  }
  return entries.sort(
    (a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key),
  );
}
