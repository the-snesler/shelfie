/**
 * The app was called Shelfie before it was Tsundo, and its localStorage keys
 * were prefixed `shelfie.` / `shelfie:`. Move any leftover ones to the
 * `tsundo` prefix once, before anything reads storage, so a returning browser
 * keeps its sign-in, cached settings, list views and the manual Planned order.
 * Imported first by entry.client.tsx for that reason.
 */
const LEGACY_PREFIX = /^shelfie(?=[.:])/;

export function migrateLegacyStorage(storage: Storage): void {
  const legacyKeys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && LEGACY_PREFIX.test(key)) legacyKeys.push(key);
  }
  for (const key of legacyKeys) {
    const next = key.replace(LEGACY_PREFIX, "tsundo");
    const value = storage.getItem(key);
    if (value !== null && storage.getItem(next) === null) {
      storage.setItem(next, value);
    }
    storage.removeItem(key);
  }
}

try {
  migrateLegacyStorage(localStorage);
} catch {
  // Storage can be unavailable (private mode, blocked site data); nothing to move.
}
