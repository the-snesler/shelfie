/** The disk cache follows library membership. Browsing keeps only a small
 * in-memory buffer so adding the open detail page also works offline. */
export interface CachedCard {
  id: string;
}

export interface CardCacheStore<T extends CachedCard> {
  ownedIds(ids?: readonly string[]): Promise<ReadonlySet<string>>;
  unreferenced(owned: ReadonlySet<string>): Promise<T[]>;
  upsert(cards: readonly T[]): Promise<void>;
  remove(cards: readonly T[]): Promise<void>;
}

export class OwnedCardCache<T extends CachedCard> {
  private readonly recent = new Map<string, T>();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: CardCacheStore<T>,
    private readonly recentLimit = 64,
  ) {}

  private remember(cards: readonly T[]): void {
    for (const card of cards) {
      this.recent.delete(card.id);
      this.recent.set(card.id, card);
      while (this.recent.size > this.recentLimit) {
        this.recent.delete(this.recent.keys().next().value!);
      }
    }
  }

  private run(task: () => Promise<void>): Promise<void> {
    const next = this.queue.then(task);
    // A failed write must not prevent future refreshes or garbage collection.
    this.queue = next.catch(() => {});
    return next;
  }

  /** Recheck around deletion: membership can change in another tab while
   * IndexedDB is busy. Restore any card whose item was added during removal. */
  private async removeUnowned(cards: readonly T[]): Promise<void> {
    if (cards.length === 0) return;
    const owned = await this.store.ownedIds(cards.map((card) => card.id));
    const removable = cards.filter((card) => !owned.has(card.id));
    if (removable.length === 0) return;
    this.remember(removable);
    await this.store.remove(removable);
    const added = await this.store.ownedIds(removable.map((card) => card.id));
    const restored = removable.filter((card) => added.has(card.id));
    await this.store.upsert(restored);
    for (const card of restored) this.recent.delete(card.id);
  }

  save(cards: readonly T[]): Promise<void> {
    return this.run(async () => {
      const owned = await this.store.ownedIds(cards.map((card) => card.id));
      this.remember(cards.filter((card) => !owned.has(card.id)));
      const persisted = cards.filter((card) => owned.has(card.id));
      await this.store.upsert(persisted);
      for (const card of persisted) this.recent.delete(card.id);
      // A delayed HTTP response must not resurrect a card after its library
      // item was removed, including when removal races this write.
      await this.removeUnowned(persisted);
    });
  }

  /** Called at startup and whenever membership changes. Finished and dropped
   * items still own their cards: calendar history and the logbook need them. */
  reconcile(): Promise<void> {
    return this.run(async () => {
      const owned = await this.store.ownedIds();
      const added = [...this.recent.values()].filter((card) =>
        owned.has(card.id),
      );
      await this.store.upsert(added);
      for (const card of added) this.recent.delete(card.id);
      await this.removeUnowned(await this.store.unreferenced(owned));
    });
  }
}
