import type {
  ActivityChanges,
  BookMetadata,
  GameMetadata,
  ItemActivity,
  ItemStatus,
  LibraryItem,
  LogFormat,
  MediaType,
  MovieMetadata,
  TvMetadata,
} from "@shelfie/shared";
import { defaultLogFormat, episodeKey } from "@shelfie/shared";
import { upsertBookCards } from "../../db/bookCards";
import type { ShelfieDatabase } from "../../db/database";
import { upsertCards } from "../../db/gameCards";
import { upsertMovieCards } from "../../db/movieCards";
import { skipGuestRefresh } from "../../db/refreshCards";
import { upsertTvCards } from "../../db/tvCards";
import { localIsoDate } from "../media/libraryActions";
import cardsJson from "./demoCards.json";

/** Card metadata captured by `scripts/demo-fixture.mjs`, so loading the demo
 *  costs nothing from the guest's anonymous catalog quota and works offline. */
export const DEMO_CARDS = cardsJson as unknown as {
  games: GameMetadata[];
  movies: MovieMetadata[];
  tv: TvMetadata[];
  books: BookMetadata[];
};

interface DemoEntry {
  mediaType: MediaType;
  sourceId: string;
  status: ItemStatus;
  addedDaysAgo: number;
  /** The status the title was first shelved with, when it later moved on. */
  addedAs?: ItemStatus;
  /** When the title reached `status`; defaults to the latest completion. */
  changedDaysAgo?: number;
  progressFormat?: LogFormat;
  progressValue?: number;
  platforms?: string[];
  rating?: number;
  excitement?: number;
  completedDaysAgo?: number[];
  notes?: string;
  /** TV: episodes 1..`count` of each season, watched two a night from
   *  `startDaysAgo`. */
  episodes?: { season: number; count: number; startDaysAgo: number }[];
}

/** A small, varied shelf that exercises every Home section and most
 *  automatic lists: in progress, paused, caught-up-able TV, planned with
 *  excitement, an unreleased wishlist title, dropped, finished, rated,
 *  unrated, and a rewatch. Dates are relative, so the demo stays current. */
export const DEMO_ITEMS: readonly DemoEntry[] = [
  // Games
  {
    mediaType: "game",
    sourceId: "7346", // Breath of the Wild
    status: "active",
    addedAs: "backlogged",
    addedDaysAgo: 75,
    changedDaysAgo: 18,
    progressValue: 31,
    platforms: ["Nintendo Switch"],
  },
  {
    mediaType: "game",
    sourceId: "14593", // Hollow Knight
    status: "completed",
    addedAs: "active",
    addedDaysAgo: 160,
    completedDaysAgo: [64],
    progressFormat: "percent",
    progressValue: 100,
    platforms: ["PC (Microsoft Windows)"],
    rating: 5,
    notes: "Every single charm. The Path of Pain was worth it.",
  },
  {
    mediaType: "game",
    sourceId: "119133", // Elden Ring
    status: "backlogged",
    addedDaysAgo: 120,
    platforms: ["PlayStation 5"],
    excitement: 4,
  },
  {
    mediaType: "game",
    sourceId: "26226", // Celeste
    status: "finished",
    addedAs: "active",
    addedDaysAgo: 220,
    completedDaysAgo: [190],
    progressValue: 9,
    platforms: ["Nintendo Switch"],
    rating: 4.5,
  },
  {
    mediaType: "game",
    sourceId: "17000", // Stardew Valley
    status: "dropped",
    addedAs: "active",
    addedDaysAgo: 140,
    changedDaysAgo: 96,
    progressValue: 14,
    platforms: ["Nintendo Switch"],
    notes: "Lovely, but it ate my evenings. Saving it for winter.",
  },
  {
    mediaType: "game",
    sourceId: "251833", // Balatro
    status: "active",
    addedAs: "backlogged",
    addedDaysAgo: 30,
    changedDaysAgo: 6,
    progressValue: 12,
    platforms: ["PC (Microsoft Windows)"],
  },
  {
    mediaType: "game",
    sourceId: "52189", // Grand Theft Auto VI
    status: "wishlisted",
    addedDaysAgo: 200,
    excitement: 4,
  },
  {
    mediaType: "game",
    sourceId: "228525", // Hades II
    status: "backlogged",
    addedDaysAgo: 45,
    platforms: ["Nintendo Switch 2"],
    excitement: 3,
  },
  // Movies
  {
    mediaType: "movie",
    sourceId: "693134", // Dune: Part Two
    status: "finished",
    addedAs: "backlogged",
    addedDaysAgo: 50,
    completedDaysAgo: [9],
    rating: 4.5,
  },
  {
    mediaType: "movie",
    sourceId: "335984", // Blade Runner 2049
    status: "backlogged",
    addedDaysAgo: 48,
    excitement: 3,
  },
  {
    mediaType: "movie",
    sourceId: "666277", // Past Lives
    status: "finished",
    addedAs: "backlogged",
    addedDaysAgo: 90,
    completedDaysAgo: [33],
    rating: 4,
  },
  {
    mediaType: "movie",
    sourceId: "545611", // Everything Everywhere All at Once
    status: "backlogged",
    addedDaysAgo: 12,
    excitement: 2,
  },
  {
    mediaType: "movie",
    sourceId: "129", // Spirited Away
    status: "finished",
    addedDaysAgo: 400,
    completedDaysAgo: [380, 21],
    rating: 5,
  },
  // TV
  {
    mediaType: "tv",
    sourceId: "95396", // Severance
    status: "active",
    addedAs: "backlogged",
    addedDaysAgo: 40,
    episodes: [
      { season: 1, count: 9, startDaysAgo: 24 },
      { season: 2, count: 4, startDaysAgo: 4 },
    ],
  },
  {
    mediaType: "tv",
    sourceId: "136315", // The Bear
    status: "paused",
    addedAs: "backlogged",
    addedDaysAgo: 150,
    changedDaysAgo: 110,
    episodes: [{ season: 1, count: 8, startDaysAgo: 126 }],
  },
  {
    mediaType: "tv",
    sourceId: "126308", // Shōgun
    status: "backlogged",
    addedDaysAgo: 60,
    excitement: 4,
  },
  {
    mediaType: "tv",
    sourceId: "94605", // Arcane
    status: "finished",
    addedAs: "backlogged",
    addedDaysAgo: 100,
    completedDaysAgo: [70],
    rating: 5,
    episodes: [
      { season: 1, count: 9, startDaysAgo: 82 },
      { season: 2, count: 9, startDaysAgo: 74 },
    ],
  },
  // Books
  {
    mediaType: "book",
    sourceId: "54493401", // Project Hail Mary
    status: "active",
    addedAs: "backlogged",
    addedDaysAgo: 35,
    changedDaysAgo: 2,
    progressValue: 214,
  },
  {
    mediaType: "book",
    sourceId: "5907", // The Hobbit
    status: "finished",
    addedAs: "active",
    addedDaysAgo: 180,
    completedDaysAgo: [152],
    rating: 5,
  },
  {
    mediaType: "book",
    sourceId: "50202953", // Piranesi
    status: "backlogged",
    addedDaysAgo: 25,
    excitement: 3,
  },
  {
    mediaType: "book",
    sourceId: "58784475", // Tomorrow, and Tomorrow, and Tomorrow
    status: "finished",
    addedAs: "active",
    addedDaysAgo: 70,
    completedDaysAgo: [44],
  },
  {
    mediaType: "book",
    sourceId: "18423", // The Left Hand of Darkness
    status: "wishlisted",
    addedDaysAgo: 15,
    excitement: 1,
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** An evening `days` ago in local time (never later than `now`). */
function evening(now: number, days: number): number {
  const date = new Date(now - days * DAY_MS);
  date.setHours(20, 30, 0, 0);
  return Math.min(date.getTime(), now);
}

/** Builds one demo item, including the activity history that the logbook,
 *  calendar, and "My activity" read, so the shelf looks lived in. */
export function buildDemoItem(entry: DemoEntry, now: number): LibraryItem {
  const id = `${entry.mediaType}:${entry.sourceId}`;
  const progressFormat =
    entry.progressFormat ?? defaultLogFormat(entry.mediaType);
  const platforms = entry.platforms ?? [];
  const completedDays = entry.completedDaysAgo ?? [];
  const completedDates = completedDays
    .map((days) => localIsoDate(new Date(evening(now, days))))
    .sort();

  const activity: ItemActivity[] = [];
  const record = (at: number, changes: ActivityChanges) =>
    activity.push({ id: `demo:${id}:${activity.length}`, at, changes });

  const addedAt = evening(now, entry.addedDaysAgo);
  record(addedAt, {
    status: entry.addedAs ?? entry.status,
    ...(platforms.length > 0 && { platforms }),
  });

  const watchedEpisodes: Record<string, string> = {};
  for (const { season, count, startDaysAgo } of entry.episodes ?? []) {
    for (let night = 0; night * 2 < count; night++) {
      const at = evening(now, startDaysAgo - night);
      const date = localIsoDate(new Date(at));
      const changes: Record<string, string> = {};
      for (let ep = night * 2 + 1; ep <= Math.min(count, night * 2 + 2); ep++)
        changes[episodeKey(season, ep)] = date;
      Object.assign(watchedEpisodes, changes);
      // An episode watched on a non-active show starts watching it.
      record(at, {
        ...(night === 0 && season === entry.episodes![0].season
          ? { status: "active" as const }
          : {}),
        watchedEpisodes: changes,
      });
    }
  }

  const finalChanges: ActivityChanges = {};
  const startedByEpisode = entry.status === "active" && entry.episodes;
  if (entry.addedAs && entry.addedAs !== entry.status && !startedByEpisode)
    finalChanges.status = entry.status;
  if (entry.progressValue !== undefined) {
    finalChanges.progressFormat = progressFormat;
    finalChanges.progressValue = entry.progressValue;
  }
  if (entry.rating !== undefined) finalChanges.rating = entry.rating;
  if (completedDates.length > 0) finalChanges.completedDates = completedDates;
  if (entry.notes) finalChanges.notes = entry.notes;
  if (Object.keys(finalChanges).length > 0) {
    const changedDaysAgo =
      entry.changedDaysAgo ?? Math.min(...completedDays, entry.addedDaysAgo);
    record(evening(now, changedDaysAgo), finalChanges);
  }

  activity.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  return {
    id,
    mediaType: entry.mediaType,
    sourceId: entry.sourceId,
    status: entry.status,
    progressFormat,
    progressValue: entry.progressValue ?? null,
    platforms,
    rating: entry.rating ?? null,
    excitement: entry.excitement ?? null,
    completedDates,
    notes: entry.notes ?? "",
    watchedEpisodes,
    activity,
    addedAt,
    updatedAt: activity[activity.length - 1].at,
  };
}

/** Fills a guest shelf with the demo titles. Titles the guest already
 *  shelved keep their own state; only the missing ones are added. */
export async function loadDemoShelf(
  db: ShelfieDatabase,
  now = Date.now(),
): Promise<void> {
  const items = DEMO_ITEMS.map((entry) => buildDemoItem(entry, now));
  skipGuestRefresh(items.map((item) => item.id));
  const existing = await db.library_items
    .findByIds(items.map((item) => item.id))
    .exec();
  const result = await db.library_items.bulkInsert(
    items.filter((item) => !existing.has(item.id)),
  );
  if (result.error.length > 0) throw result.error[0];
  // Cards persist only for owned ids, so write them after the items.
  await Promise.all([
    upsertCards(db, DEMO_CARDS.games),
    upsertMovieCards(db, DEMO_CARDS.movies),
    upsertTvCards(db, DEMO_CARDS.tv),
    upsertBookCards(db, DEMO_CARDS.books),
  ]);
}
