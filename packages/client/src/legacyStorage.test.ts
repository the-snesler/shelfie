import { describe, expect, it } from "vitest";
import { migrateLegacyStorage } from "./legacyStorage";

function memoryStorage(initial: Record<string, string>): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
}

function entries(storage: Storage): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)!;
    out[key] = storage.getItem(key)!;
  }
  return out;
}

describe("migrateLegacyStorage", () => {
  it("moves shelfie.* and shelfie:* keys to the tsundo prefix", () => {
    const storage = memoryStorage({
      "shelfie.authToken": "tok",
      "shelfie:planned-order": '["game:1"]',
      unrelated: "keep",
    });
    migrateLegacyStorage(storage);
    expect(entries(storage)).toEqual({
      unrelated: "keep",
      "tsundo.authToken": "tok",
      "tsundo:planned-order": '["game:1"]',
    });
  });

  it("never overwrites a tsundo key that already exists", () => {
    const storage = memoryStorage({
      "shelfie.authToken": "old",
      "tsundo.authToken": "new",
    });
    migrateLegacyStorage(storage);
    expect(entries(storage)).toEqual({ "tsundo.authToken": "new" });
  });

  it("leaves look-alike keys without a separator alone", () => {
    const storage = memoryStorage({ shelfiedb: "x" });
    migrateLegacyStorage(storage);
    expect(entries(storage)).toEqual({ shelfiedb: "x" });
  });
});
