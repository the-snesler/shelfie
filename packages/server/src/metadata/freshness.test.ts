import { describe, expect, it } from "vitest";
import { releaseExpired } from "./freshness.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-11-06T12:00:00Z");

describe("releaseExpired", () => {
  it("refreshes daily in the month before a release", () => {
    expect(releaseExpired(["2026-11-20"], now - 2 * DAY_MS, now)).toBe(true);
    expect(releaseExpired(["2026-11-20"], now - DAY_MS / 2, now)).toBe(false);
    // Further out, the flat weekly TTL is enough.
    expect(releaseExpired(["2027-03-01"], now - 2 * DAY_MS, now)).toBe(false);
  });

  it("refreshes once after a release day passes", () => {
    const fetchedBefore = Date.parse("2026-11-05T12:00:00Z");
    expect(releaseExpired(["2026-11-06"], fetchedBefore, now)).toBe(true);
    expect(releaseExpired(["2026-11-06"], now - 1000, now)).toBe(false);
    expect(releaseExpired([], 0, now)).toBe(false);
  });
});
