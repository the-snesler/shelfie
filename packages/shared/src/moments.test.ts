import { describe, expect, it } from "vitest";
import {
  compareMoments,
  dayCouldHold,
  instantMoment,
  isInstant,
  isMoment,
  latestMoment,
  momentDay,
  momentSortKey,
} from "./moments.js";

describe("moments", () => {
  it("recognizes bare days and canonical instants", () => {
    expect(isMoment("2026-11-22")).toBe(true);
    expect(isMoment(instantMoment(new Date(2026, 10, 22, 23, 46)))).toBe(true);
    expect(isMoment("2026-11-22T23:46:00Z")).toBe(false);
    expect(isInstant("2026-11-22")).toBe(false);
    expect(isInstant("2026-11-22T05:00:00.000Z")).toBe(true);
  });

  it("places an instant on its local day", () => {
    const lateEvening = new Date(2026, 10, 21, 23, 30);
    expect(momentDay(instantMoment(lateEvening))).toBe("2026-11-21");
    expect(momentDay("2026-11-21")).toBe("2026-11-21");
  });

  it("orders by local time, a bare day before that day's instants", () => {
    const at = (hours: number) => instantMoment(new Date(2026, 10, 21, hours));
    expect(momentSortKey("2026-11-21") < momentSortKey(at(0))).toBe(true);
    expect(
      ["2026-11-22", at(22), "2026-11-21", at(8)].sort(compareMoments),
    ).toEqual(["2026-11-21", at(8), at(22), "2026-11-22"]);
    expect(latestMoment([at(8), "2026-11-21", at(22)])).toBe(at(22));
    expect(latestMoment([])).toBeNull();
  });

  it("matches a bare day to any instant some time zone puts on it", () => {
    // 2026-11-22T05:00Z is the evening of the 21st in the Americas.
    expect(dayCouldHold("2026-11-21", "2026-11-22T05:00:00.000Z")).toBe(true);
    expect(dayCouldHold("2026-11-22", "2026-11-22T05:00:00.000Z")).toBe(true);
    // UTC+14 reaches the 23rd at 10:00Z on the 22nd.
    expect(dayCouldHold("2026-11-23", "2026-11-22T10:00:00.000Z")).toBe(true);
    expect(dayCouldHold("2026-11-23", "2026-11-22T09:59:59.999Z")).toBe(false);
    expect(dayCouldHold("2026-11-20", "2026-11-22T05:00:00.000Z")).toBe(false);
  });
});
