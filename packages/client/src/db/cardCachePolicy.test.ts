import { describe, expect, it } from "vitest";
import { OwnedCardCache, type CardCacheStore } from "./cardCachePolicy";

interface Card {
  id: string;
  name: string;
}

function fixture(recentLimit = 64) {
  const owned = new Set<string>();
  const disk = new Map<string, Card>();
  let afterWrite: (() => void) | undefined;
  let afterRemove: (() => void) | undefined;
  const store: CardCacheStore<Card> = {
    async ownedIds() {
      return new Set(owned);
    },
    async unreferenced(ids) {
      return [...disk.values()].filter((card) => !ids.has(card.id));
    },
    async upsert(cards) {
      for (const card of cards) disk.set(card.id, card);
      afterWrite?.();
    },
    async remove(cards) {
      for (const card of cards) disk.delete(card.id);
      afterRemove?.();
    },
  };
  return {
    cache: new OwnedCardCache(store, recentLimit),
    owned,
    disk,
    onWrite: (hook: () => void) => (afterWrite = hook),
    onRemove: (hook: () => void) => (afterRemove = hook),
  };
}

const card = (id: string): Card => ({ id, name: `Title ${id}` });

describe("owned card cache lifecycle", () => {
  it("collects historical browsing cards on startup and preserves every owned medium", async () => {
    const { cache, owned, disk } = fixture();
    for (const id of ["game:1", "movie:2", "tv:3", "book:4"]) {
      owned.add(id);
      disk.set(id, card(id));
    }
    disk.set("book:99", card("book:99"));
    await cache.reconcile();
    expect([...disk.keys()].sort()).toEqual([...owned].sort());
  });

  it("keeps browsing off disk and warms a newly added item without another request", async () => {
    const { cache, owned, disk } = fixture();
    await cache.save([card("tv:1")]);
    expect(disk.size).toBe(0);
    owned.add("tv:1");
    await cache.reconcile();
    expect(disk.get("tv:1")).toEqual(card("tv:1"));
    owned.delete("tv:1");
    await cache.reconcile();
    expect(disk.size).toBe(0);
  });

  it("bounds the browsing buffer and retains the most recently viewed cards", async () => {
    const { cache, owned, disk } = fixture(2);
    await cache.save([card("book:1"), card("book:2")]);
    await cache.save([card("book:1"), card("book:3")]);
    for (const id of ["book:1", "book:2", "book:3"]) owned.add(id);
    await cache.reconcile();
    expect([...disk.keys()].sort()).toEqual(["book:1", "book:3"]);
  });

  it("does not resurrect a removed item when its HTTP refresh returns late", async () => {
    const { cache, owned, disk } = fixture();
    owned.add("movie:1");
    await cache.save([card("movie:1")]);
    owned.delete("movie:1");
    await Promise.all([
      cache.reconcile(),
      cache.save([{ id: "movie:1", name: "Delayed refresh" }]),
    ]);
    expect(disk.size).toBe(0);
  });

  it("collects a card when ownership disappears during a write", async () => {
    const { cache, owned, disk, onWrite } = fixture();
    owned.add("game:1");
    onWrite(() => owned.delete("game:1"));
    await cache.save([card("game:1")]);
    expect(disk.size).toBe(0);
  });

  it("restores a card when another tab adds its item during collection", async () => {
    const { cache, owned, disk, onRemove } = fixture();
    disk.set("book:1", card("book:1"));
    onRemove(() => owned.add("book:1"));
    await cache.reconcile();
    expect(disk.get("book:1")).toEqual(card("book:1"));
  });

  it("does not overwrite a newer owned card from an earlier browsing snapshot", async () => {
    const { cache, owned, disk } = fixture();
    await cache.save([card("tv:1")]);
    owned.add("tv:1");
    await cache.reconcile();
    disk.set("tv:1", { id: "tv:1", name: "Fresh card from another tab" });
    await cache.reconcile();
    expect(disk.get("tv:1")?.name).toBe("Fresh card from another tab");
  });

  it("recovers its write queue after a storage error", async () => {
    const { cache, owned, disk, onWrite } = fixture();
    owned.add("tv:1");
    onWrite(() => {
      throw new Error("Temporary IndexedDB failure");
    });
    await expect(cache.save([card("tv:1")])).rejects.toThrow("Temporary");
    onWrite(() => {});
    await cache.save([{ id: "tv:1", name: "Recovered" }]);
    expect(disk.get("tv:1")?.name).toBe("Recovered");
  });
});
