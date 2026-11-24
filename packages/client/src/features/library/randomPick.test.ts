import { describe, expect, it } from "vitest";
import { rouletteHops } from "./randomPick";

function seeded(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}

describe("rouletteHops", () => {
  it("ends on the winner and never repeats a card twice in a row", () => {
    for (let seed = 1; seed < 50; seed++) {
      const hops = rouletteHops(["a", "b", "c", "d"], "c", seeded(seed));
      expect(hops.at(-1)?.id).toBe("c");
      expect(hops.at(-2)?.id).not.toBe("c");
      for (let index = 1; index < hops.length; index++) {
        expect(hops[index].id).not.toBe(hops[index - 1].id);
      }
    }
  });

  it("slows down as it goes", () => {
    const delays = rouletteHops(["a", "b", "c"], "a").map((hop) => hop.delay);
    for (let index = 1; index < delays.length; index++) {
      expect(delays[index]).toBeGreaterThan(delays[index - 1]);
    }
  });

  it("can land on a winner outside the hop pool", () => {
    const hops = rouletteHops(["a", "b"], "z");
    expect(hops.at(-1)?.id).toBe("z");
    expect(hops.slice(0, -1).every((hop) => hop.id !== "z")).toBe(true);
  });

  it("goes straight to the winner when there's nothing to hop across", () => {
    expect(rouletteHops(["a"], "a").map((hop) => hop.id)).toEqual(["a"]);
  });
});
