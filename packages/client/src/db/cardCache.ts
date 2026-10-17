import type { MediaType } from "@shelfie/shared";
import type { RxCollection } from "rxdb";
import type { BookCardDoc } from "./bookCards";
import { OwnedCardCache } from "./cardCachePolicy";
import type { ShelfieDatabase } from "./database";
import type { GameCardDoc } from "./gameCards";
import type { MovieCardDoc } from "./movieCards";
import type { TvCardDoc } from "./tvCards";

export type CardMeta = GameCardDoc | MovieCardDoc | TvCardDoc | BookCardDoc;

const caches = new WeakMap<ShelfieDatabase, OwnedCardCache<CardMeta>>();
const CARD_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const CARD_TOMBSTONE_RETENTION_MS = 24 * 60 * 60 * 1000;

function cacheFor(db: ShelfieDatabase): OwnedCardCache<CardMeta> {
  const existing = caches.get(db);
  if (existing) return existing;

  async function writeMedium<T extends CardMeta>(
    collection: RxCollection<T>,
    mediaType: MediaType,
    cards: readonly CardMeta[],
    remove: boolean,
  ): Promise<void> {
    // Collection names and card ids share the same fixed media namespace.
    const matching = cards.filter((card) =>
      card.id.startsWith(`${mediaType}:`),
    ) as T[];
    if (matching.length === 0) return;
    const result = remove
      ? await collection.bulkRemove(matching.map((card) => card.id))
      : await collection.bulkUpsert(matching);
    if (result.error.length > 0) throw result.error[0];
  }

  async function write(cards: readonly CardMeta[], remove: boolean) {
    await Promise.all([
      writeMedium(db.game_metadata, "game", cards, remove),
      writeMedium(db.movie_metadata, "movie", cards, remove),
      writeMedium(db.tv_metadata, "tv", cards, remove),
      writeMedium(db.book_metadata, "book", cards, remove),
    ]);
  }

  const cache = new OwnedCardCache<CardMeta>({
    async ownedIds(ids) {
      const found = ids
        ? [...(await db.library_items.findByIds([...ids]).exec()).values()]
        : await db.library_items.find().exec();
      return new Set(found.map((item) => item.id));
    },
    async unreferenced(owned) {
      const selector = { id: { $nin: [...owned] } };
      const found = await Promise.all([
        db.game_metadata.find({ selector }).exec(),
        db.movie_metadata.find({ selector }).exec(),
        db.tv_metadata.find({ selector }).exec(),
        db.book_metadata.find({ selector }).exec(),
      ]);
      return found.flatMap((docs) => docs.map((doc) => doc.toMutableJSON()));
    },
    upsert: (cards) => write(cards, false),
    remove: (cards) => write(cards, true),
  });
  caches.set(db, cache);
  return cache;
}

export async function upsertOwnedCards(
  db: ShelfieDatabase,
  cards: CardMeta[],
): Promise<void> {
  if (cards.length === 0) return;
  await cacheFor(db).save(cards);
}

/** Database-owned rather than screen-owned, so removing items from detail,
 * imports, or another tab also collects their cards. */
export function startCardCacheLifecycle(db: ShelfieDatabase): () => void {
  let previous: string | undefined;
  const subscription = db.library_items.find().$.subscribe((items) => {
    const membership = items
      .map((item) => item.id)
      .sort()
      .join(",");
    if (membership === previous) return;
    previous = membership;
    void cacheFor(db)
      .reconcile()
      .catch((error: unknown) => {
        console.warn("Could not prune local card caches", error);
      });
  });
  let stopped = false;
  let cleaning = false;
  async function cleanup() {
    if (cleaning || stopped) return;
    cleaning = true;
    try {
      await cacheFor(db).reconcile();
      // Cache deletions are local-only. Purge old tombstones too, otherwise
      // repeated add/remove cycles would still leave IndexedDB growing.
      // Never do this to the replicated library collection.
      for (const collection of [
        db.game_metadata,
        db.movie_metadata,
        db.tv_metadata,
        db.book_metadata,
      ]) {
        let done = false;
        while (!stopped && !db.closed && !done) {
          await db.requestIdlePromise();
          if (stopped || db.closed) return;
          done = await collection.storageInstance.cleanup(
            CARD_TOMBSTONE_RETENTION_MS,
          );
        }
      }
    } catch (error: unknown) {
      console.warn("Could not clean local card caches", error);
    } finally {
      cleaning = false;
    }
  }
  void cleanup();
  const interval = setInterval(() => void cleanup(), CARD_CLEANUP_INTERVAL_MS);
  return () => {
    stopped = true;
    clearInterval(interval);
    subscription.unsubscribe();
  };
}

/** Only read the card ids the caller owns or displays. Empty media types do
 * not subscribe at all, and orphaned cards never enter a screen's state. */
export function subscribeCardCaches(
  db: ShelfieDatabase,
  ids: readonly string[],
  receive: (prefix: string, cards: readonly CardMeta[]) => void,
): () => void {
  function subscribe<T extends CardMeta>(
    collection: RxCollection<T>,
    type: MediaType,
  ) {
    const prefix = `${type}:`;
    const matching = ids.filter((id) => id.startsWith(prefix));
    if (matching.length === 0) {
      receive(prefix, []);
      return;
    }
    return collection.findByIds(matching).$.subscribe((cards) => {
      receive(prefix, [...cards.values()]);
    });
  }
  const subscriptions = [
    subscribe(db.game_metadata, "game"),
    subscribe(db.movie_metadata, "movie"),
    subscribe(db.tv_metadata, "tv"),
    subscribe(db.book_metadata, "book"),
  ];
  return () => {
    for (const subscription of subscriptions) subscription?.unsubscribe();
  };
}
