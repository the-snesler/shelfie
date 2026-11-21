import { describe, expect, it } from "vitest";
import { selectCaseKey, selectGameCase, selectPlatform } from "./platforms";

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

/** Epoch seconds for Jan 1 of `year` (UTC). */
const jan1 = (year: number) => Date.UTC(year, 0, 1) / 1000;

describe("selectCaseKey", () => {
  it("passes non-PC platforms through unchanged", () => {
    expect(selectCaseKey("PlayStation 4", [])).toBe("PlayStation 4");
    expect(selectCaseKey(null, [])).toBeNull();
  });

  it.each([
    [1993, "PC big box"],
    [2001, "PC big box"],
    [2002, "PC jewel case"],
    [2005, "PC jewel case"],
    [2006, "PC DVD"],
    [2014, "PC DVD"],
    [2015, PC],
    [2024, PC],
  ])("gives a %i PC release the %s case", (year, caseKey) => {
    expect(selectCaseKey(PC, [{ platform: PC, date: jan1(year) }])).toBe(
      caseKey,
    );
  });

  it("dates by the PC release, not an earlier console one", () => {
    expect(
      selectCaseKey(PC, [
        { platform: "PlayStation 2", date: jan1(2001) },
        { platform: PC, date: jan1(2008) },
      ]),
    ).toBe("PC DVD");
  });

  it("falls back to the earliest release on any platform", () => {
    expect(
      selectCaseKey(PC, [{ platform: "PlayStation", date: jan1(1997) }]),
    ).toBe("PC big box");
  });

  it("uses the modern strip for undated PC games and a big box for DOS", () => {
    expect(selectCaseKey(PC, [])).toBe(PC);
    expect(selectCaseKey("DOS", [])).toBe("PC big box");
  });
});

describe("selectGameCase", () => {
  it("auto-picks DOS for a DOS-only game and boxes it", () => {
    expect(
      selectGameCase([], ["DOS"], [{ platform: "DOS", date: jan1(1993) }]),
    ).toBe("PC big box");
  });
});

describe("selectGameCase with a storefront", () => {
  const pcRelease = [{ platform: PC, date: jan1(1998) }];

  it("swaps the case for the owner's store strip on PC", () => {
    expect(selectGameCase([PC], [PC], pcRelease, "gog")).toBe("store:gog");
    expect(selectGameCase(["Linux"], [PC, "Linux"], pcRelease, "steam")).toBe(
      "store:steam",
    );
  });

  it("ignores the store when the first owned platform is a console", () => {
    expect(
      selectGameCase(["PlayStation 4", PC], [PC], pcRelease, "steam"),
    ).toBe("PlayStation 4");
  });

  it("ignores the store when the platform came from metadata", () => {
    expect(selectGameCase([], [PC], pcRelease, "steam")).toBe("PC big box");
  });

  it("keeps the era case when no store is set", () => {
    expect(selectGameCase([PC], [PC], pcRelease, null)).toBe("PC big box");
  });
});
