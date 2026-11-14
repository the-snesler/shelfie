import { libraryItemDocSchema } from "@shelfie/shared";
import { describe, expect, it } from "vitest";
import { STATUSES_BY_MEDIA } from "../media/status";
import { buildDemoItem, DEMO_CARDS, DEMO_ITEMS } from "./demoShelf";

const NOW = new Date(2026, 10, 13, 12).getTime();
const items = DEMO_ITEMS.map((entry) => buildDemoItem(entry, NOW));

function cardIds(): string[] {
  return [
    ...DEMO_CARDS.games.map((card) => `game:${card.igdbId}`),
    ...DEMO_CARDS.movies.map((card) => `movie:${card.tmdbId}`),
    ...DEMO_CARDS.tv.map((card) => `tv:${card.tmdbId}`),
    ...DEMO_CARDS.books.map((card) => `book:${card.goodreadsId}`),
  ];
}

describe("demo shelf", () => {
  it("bundles exactly one card per demo title", () => {
    expect(cardIds().sort()).toEqual(items.map((item) => item.id).sort());
  });

  it("builds items that pass the sync validator, so they could be pushed later", () => {
    for (const item of items) {
      const parsed = libraryItemDocSchema.safeParse({
        ...item,
        _deleted: false,
      });
      expect(parsed.error?.issues ?? [], item.id).toEqual([]);
      expect(STATUSES_BY_MEDIA[item.mediaType], item.id).toContain(item.status);
    }
  });

  it("keeps history in the past and in order, ending at updatedAt", () => {
    for (const item of items) {
      const times = item.activity.map((event) => event.at);
      expect(times, item.id).toEqual([...times].sort((a, b) => a - b));
      expect(item.addedAt).toBe(times[0]);
      expect(item.updatedAt).toBe(times[times.length - 1]);
      expect(item.updatedAt).toBeLessThanOrEqual(NOW);
      expect(new Set(item.activity.map((event) => event.id)).size).toBe(
        item.activity.length,
      );
    }
  });

  it("only marks episodes the bundled TV catalog has aired", () => {
    for (const card of DEMO_CARDS.tv) {
      const item = items.find(({ id }) => id === `tv:${card.tmdbId}`)!;
      const watched = Object.keys(item.watchedEpisodes);
      expect(watched.length).toBeLessThanOrEqual(card.airedEpisodes ?? 0);
      if (item.status === "finished")
        expect(watched).toHaveLength(card.airedEpisodes ?? -1);
    }
  });
});
