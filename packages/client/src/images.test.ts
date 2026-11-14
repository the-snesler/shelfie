import { rgbaToThumbHash } from "thumbhash";
import { describe, expect, it } from "vitest";
import { coverPlaceholderStyle, coverPlaceholderUrl } from "./images";

function solidHash(r: number, g: number, b: number): string {
  const rgba = new Uint8Array(20 * 30 * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([r, g, b, 255], i);
  return btoa(String.fromCharCode(...rgbaToThumbHash(20, 30, rgba)));
}

describe("coverPlaceholderUrl", () => {
  it("decodes a card's ThumbHash into a PNG data URL, once per hash", () => {
    const hash = solidHash(200, 40, 40);
    const url = coverPlaceholderUrl(hash);
    expect(url).toMatch(/^data:image\/png;base64,/);
    expect(coverPlaceholderUrl(hash)).toBe(url);
  });

  it("paints nothing without a usable hash", () => {
    expect(coverPlaceholderUrl(null)).toBeUndefined();
    expect(coverPlaceholderUrl(undefined)).toBeUndefined();
    expect(coverPlaceholderUrl("not base64!")).toBeUndefined();
    expect(coverPlaceholderStyle(null)).toBeUndefined();
  });

  it("keeps the placeholder inside the image's content box", () => {
    expect(coverPlaceholderStyle(solidHash(0, 0, 0))).toMatchObject({
      backgroundSize: "cover",
      backgroundOrigin: "content-box",
      backgroundClip: "content-box",
    });
  });
});
