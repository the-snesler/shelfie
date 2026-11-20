import { describe, expect, it } from "vitest";
import { selectPlatform } from "./platforms";

const PC = "PC (Microsoft Windows)";

describe("selectPlatform", () => {
  it("uses the user's first recorded platform verbatim", () => {
    expect(selectPlatform(["Linux", PC], [PC, "Linux"], [])).toBe("Linux");
  });

  it("picks the earliest-released templated platform", () => {
    expect(
      selectPlatform(
        [],
        ["Nintendo Switch", PC],
        [
          { platform: PC, date: 100 },
          { platform: "Nintendo Switch", date: 200 },
        ],
      ),
    ).toBe(PC);
  });

  it("skips Mac/Linux ports when another templated platform exists", () => {
    expect(
      selectPlatform(
        [],
        ["Linux", "Mac", PC],
        [
          { platform: "Linux", date: 100 },
          { platform: "Mac", date: 100 },
          { platform: PC, date: 200 },
        ],
      ),
    ).toBe(PC);
  });

  it("falls back to a port when it is the only templated platform", () => {
    expect(
      selectPlatform(
        [],
        ["Linux", "Web browser"],
        [
          { platform: "Web browser", date: 50 },
          { platform: "Linux", date: 100 },
        ],
      ),
    ).toBe("Linux");
  });

  it("falls back to the earliest platform when none are templated", () => {
    expect(
      selectPlatform(
        [],
        ["Web browser"],
        [{ platform: "Web browser", date: 1 }],
      ),
    ).toBe("Web browser");
  });
});
