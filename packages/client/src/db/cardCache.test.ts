import { describe, expect, it, vi } from "vitest";
import { subscribeCardCaches } from "./cardCache";
import type { ShelfieDatabase } from "./database";

describe("scoped card subscriptions", () => {
  it("queries only displayed ids and skips media types with no owned items", () => {
    function collection() {
      const unsubscribe = vi.fn();
      const subscribe = vi.fn(() => ({ unsubscribe }));
      return { findByIds: vi.fn(() => ({ $: { subscribe } })), unsubscribe };
    }
    const db = {
      game_metadata: collection(),
      movie_metadata: collection(),
      tv_metadata: collection(),
      book_metadata: collection(),
    };
    const receive = vi.fn();
    const stop = subscribeCardCaches(
      db as unknown as ShelfieDatabase,
      ["game:2", "tv:4"],
      receive,
    );
    expect(db.game_metadata.findByIds).toHaveBeenCalledWith(["game:2"]);
    expect(db.tv_metadata.findByIds).toHaveBeenCalledWith(["tv:4"]);
    expect(db.movie_metadata.findByIds).not.toHaveBeenCalled();
    expect(db.book_metadata.findByIds).not.toHaveBeenCalled();
    expect(receive).toHaveBeenCalledWith("movie:", []);
    expect(receive).toHaveBeenCalledWith("book:", []);
    stop();
    expect(db.game_metadata.unsubscribe).toHaveBeenCalledOnce();
    expect(db.tv_metadata.unsubscribe).toHaveBeenCalledOnce();
  });
});
