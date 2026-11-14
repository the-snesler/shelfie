import type { LibraryItem } from "@shelfie/shared";
import { describe, expect, it } from "vitest";
import type { BookCardDoc } from "../../db/bookCards";
import type { TvCardDoc } from "../../db/tvCards";
import {
  airingLabel,
  cardCaption,
  hasAired,
  upcomingEpisode,
  type NextEpisode,
} from "./libraryCaptions";

const next: NextEpisode = {
  season: 2,
  episode: 1,
  name: "Premiere",
  airDate: "2026-10-18",
  stillPath: null,
};

const card = {
  nextEpisodeToAir: {
    seasonNumber: 2,
    episodeNumber: 2,
    name: "Next",
    airDate: "2026-10-25",
    stillPath: null,
  },
} as TvCardDoc;

describe("TV library airing labels", () => {
  it("uses the viewer's local calendar day to decide when an episode airs", () => {
    expect(hasAired(next, "2026-10-17")).toBe(false);
    expect(hasAired(next, "2026-10-18")).toBe(true);
    expect(hasAired({ ...next, airDate: "" }, "2026-10-18")).toBe(false);
    expect(airingLabel("2026-10-17", "2026-10-17")).toBe("Airs today");
    expect(airingLabel("2026-10-18", "2026-10-17")).toBe("Airs tomorrow");
  });

  it("shows the catalog's next dated episode with a card fallback offline", () => {
    expect(upcomingEpisode(next, card, {}, "2026-10-17")).toEqual({
      season: 2,
      episode: 1,
      airDate: "2026-10-18",
    });
    expect(upcomingEpisode(null, card, {}, "2026-10-17")).toEqual({
      season: 2,
      episode: 2,
      airDate: "2026-10-25",
    });
  });

  it("excludes stale and already watched card airings", () => {
    expect(upcomingEpisode(null, card, {}, "2026-10-26")).toBeNull();
    expect(
      upcomingEpisode(null, card, { s2e2: "2026-10-25" }, "2026-10-17"),
    ).toBeNull();
    expect(upcomingEpisode(next, card, {}, "2026-10-19")?.episode).toBe(2);
  });
});

describe("book captions", () => {
  const book = (patch: Partial<LibraryItem>) =>
    ({
      mediaType: "book",
      status: "active",
      progressFormat: "percent",
      progressValue: null,
      ...patch,
    }) as LibraryItem;
  const meta = { pageCount: 1080 } as BookCardDoc;

  it("leads with a percentage for percent and page logs", () => {
    expect(cardCaption(book({ progressValue: 27 }), meta)).toBe(
      "27% · 1080 pages",
    );
    expect(
      cardCaption(book({ progressFormat: "pages", progressValue: 410 }), meta),
    ).toBe("37% · 1080 pages");
    expect(
      cardCaption(book({ progressFormat: "pages", progressValue: 1079 }), meta),
    ).toBe("99% · 1080 pages");
  });

  it("falls back when the page count is unknown or progress can't be coerced", () => {
    expect(cardCaption(book({ progressValue: 27 }), undefined)).toBe("27%");
    expect(
      cardCaption(
        book({ progressFormat: "pages", progressValue: 41 }),
        undefined,
      ),
    ).toBe("p. 41");
    expect(
      cardCaption(book({ progressFormat: "hours", progressValue: 3 }), meta),
    ).toBe("3h · 1080 pages");
  });

  it("shows only the length before starting and once finished", () => {
    expect(cardCaption(book({}), meta)).toBe("1080 pages");
    expect(cardCaption(book({ progressValue: 0 }), meta)).toBe("1080 pages");
    expect(
      cardCaption(book({ status: "finished", progressValue: 100 }), meta),
    ).toBe("1080 pages");
    expect(
      cardCaption(book({ status: "wishlisted", progressValue: 10 }), undefined),
    ).toBeNull();
  });
});
