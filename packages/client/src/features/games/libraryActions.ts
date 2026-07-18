import type { ItemStatus, LibraryItem } from "@shelfie/shared";
import { defaultLogFormat } from "@shelfie/shared";

export interface LogGame {
  igdbId: number;
  name: string;
  platforms: string[];
}

/** Builds a fresh backlog-ready LibraryItem doc (same shape Detail inserts today). */
export function newLibraryItem(game: LogGame, status: ItemStatus): LibraryItem {
  const now = Date.now();
  return {
    id: `game:${game.igdbId}`,
    mediaType: "game",
    sourceId: String(game.igdbId),
    status,
    progressFormat: defaultLogFormat("game"),
    progressValue: null,
    platforms: [],
    rating: null,
    completedDates: [],
    notes: "",
    addedAt: now,
    updatedAt: now,
  };
}
