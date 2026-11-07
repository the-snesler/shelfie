import { describe, expect, it } from "vitest";
import { gameCoverUrl } from "../../images";
import { platformCoverShape } from "./platforms";

describe("platformCoverShape", () => {
  it("fits each case's art window (below its banner) to the nearest bucket", () => {
    expect(
      Object.fromEntries(
        [
          "PlayStation",
          "PlayStation 2",
          "PlayStation 3",
          "PlayStation 4",
          "PlayStation 5",
          "PlayStation Portable",
          "PlayStation Vita",
          "Xbox",
          "Xbox 360",
          "Xbox One",
          "Xbox Series X|S",
          "Nintendo GameCube",
          "Wii",
          "Wii U",
          "Nintendo DS",
          "Nintendo 3DS",
          "Nintendo Switch",
          "Nintendo Switch 2",
        ].map((platform) => [platform, platformCoverShape(platform)]),
      ),
    ).toEqual({
      PlayStation: "square",
      "PlayStation 2": "iso",
      "PlayStation 3": "square",
      "PlayStation 4": "square",
      "PlayStation 5": "square",
      "PlayStation Portable": "tall",
      "PlayStation Vita": "square",
      Xbox: "iso",
      "Xbox 360": "iso",
      "Xbox One": "square",
      "Xbox Series X|S": "square",
      "Nintendo GameCube": "iso",
      Wii: "iso",
      "Wii U": "square",
      "Nintendo DS": "square",
      "Nintendo 3DS": "square",
      "Nintendo Switch": "tall",
      "Nintendo Switch 2": "iso",
    });
  });

  it("leaves untemplated platforms on IGDB art", () => {
    expect(platformCoverShape("PC (Microsoft Windows)")).toBeNull();
    expect(platformCoverShape(null)).toBeNull();
  });
});

describe("gameCoverUrl", () => {
  it("builds the fitted route with the IGDB cover as its fallback", () => {
    expect(
      gameCoverUrl("/api/images/t_cover_big/co1r76", 1942, "square", "thumb"),
    ).toBe("/api/images/covers/thumb/square/1942?fallback=co1r76");
    expect(gameCoverUrl(null, 1942, "tall", "full")).toBe(
      "/api/images/covers/full/tall/1942",
    );
  });

  it("keeps the IGDB cover without a shape or id", () => {
    const igdb = "/api/images/t_cover_big/co1r76";
    expect(gameCoverUrl(igdb, 1942, null, "thumb")).toBe(igdb);
    expect(gameCoverUrl(igdb, undefined, "square", "thumb")).toBe(igdb);
  });
});
