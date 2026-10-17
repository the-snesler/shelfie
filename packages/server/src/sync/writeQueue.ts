const queues = new Map<string, Promise<void>>();

/**
 * Serialize each collection's complete read/compare/write operation, including
 * assigning sequence numbers and publishing checkpoints. SQLite's connection
 * mutex alone cannot protect an operation spanning several awaited queries.
 */
export function withCollectionWriteLock<T>(
  collection: string,
  write: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(collection) ?? Promise.resolve();
  const result = previous.then(write);
  // Keep the queue usable after a failed write without hiding that failure
  // from the caller. Different collections retain independent queues.
  const settled = result.then(
    () => {},
    () => {},
  );
  queues.set(collection, settled);
  void settled.then(() => {
    if (queues.get(collection) === settled) queues.delete(collection);
  });
  return result;
}
