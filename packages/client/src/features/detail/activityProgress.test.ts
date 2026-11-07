import { describe, expect, it } from "vitest";
import type { ItemActivity, LogFormat } from "@shelfie/shared";
import { describeProgressLine, progressLines } from "./activityProgress";

function log(
  values: (number | null)[],
  format: LogFormat = "hours",
): ItemActivity[] {
  return values.map((progressValue, index) => ({
    id: `e${index}`,
    at: index,
    changes: { progressFormat: format, progressValue },
  }));
}

function described(activity: ItemActivity[]): Record<string, string> {
  return Object.fromEntries(
    [...progressLines(activity, "hours")].map(([id, line]) => [
      id,
      describeProgressLine(line),
    ]),
  );
}

describe("progressLines", () => {
  it("shows the difference from the previous total", () => {
    expect(described(log([5, 12]))).toEqual({
      e0: "Logged 5 hours",
      e1: "Logged 7 hours",
    });
  });

  it("rewrites the last entry when a correction lowers the total", () => {
    expect(described(log([5, 100, 10]))).toEqual({
      e0: "Logged 5 hours",
      e1: "Logged 5 hours",
    });
    expect(described(log([5, 2]))).toEqual({ e0: "Logged 2 hours" });
  });

  it("folds every entry the correction undoes into the earliest one", () => {
    expect(described(log([5, 12, 20, 3, 4]))).toEqual({
      e0: "Logged 3 hours",
      e4: "Logged 1 hour",
    });
  });

  it("drops entries entirely when the correction leaves nothing logged", () => {
    expect(described(log([5, 12, 5]))).toEqual({ e0: "Logged 5 hours" });
    expect(described(log([5, 0]))).toEqual({});
    expect(described(log([0]))).toEqual({});
  });

  it("starts a new run after clearing or switching units", () => {
    expect(
      described([
        ...log([10]),
        { id: "clear", at: 5, changes: { progressValue: null } },
        {
          id: "p",
          at: 6,
          changes: { progressFormat: "pages", progressValue: 40 },
        },
        {
          id: "p2",
          at: 7,
          changes: { progressFormat: "pages", progressValue: 30 },
        },
      ]),
    ).toEqual({
      e0: "Logged 10 hours",
      clear: "Cleared progress",
      p: "Logged 30 pages",
    });
  });

  it("shows percent as the total reached, with corrections applied", () => {
    expect(described(log([40, 55], "percent"))).toEqual({
      e0: "Reached 40%",
      e1: "Reached 55%",
    });
    expect(described(log([40, 90, 45], "percent"))).toEqual({
      e0: "Reached 40%",
      e1: "Reached 45%",
    });
    expect(described(log([40, 10], "percent"))).toEqual({
      e0: "Reached 10%",
    });
  });

  it("rounds fractional differences", () => {
    expect(described(log([1.1, 2.3], "hours"))).toEqual({
      e0: "Logged 1.1 hours",
      e1: "Logged 1.2 hours",
    });
  });
});
