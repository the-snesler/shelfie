import { describe, expect, it } from "vitest";
import { isCompletion } from "./celebrate";

describe("isCompletion", () => {
  it("celebrates moving into a completion status", () => {
    expect(isCompletion("active", "finished")).toBe(true);
    expect(isCompletion("backlogged", "completed")).toBe(true);
    expect(isCompletion(null, "finished")).toBe(true);
  });

  it("ignores non-completion targets", () => {
    expect(isCompletion("finished", "active")).toBe(false);
    expect(isCompletion(null, "backlogged")).toBe(false);
  });

  it("ignores staying complete unless it's a logged repeat", () => {
    expect(isCompletion("finished", "finished")).toBe(false);
    expect(isCompletion("finished", "completed")).toBe(false);
    expect(isCompletion("finished", "finished", { repeat: true })).toBe(true);
  });
});
