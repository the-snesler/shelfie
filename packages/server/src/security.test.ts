import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  createCorsMiddleware,
  createRateLimit,
  isPublicCatalogRequest,
} from "./security.js";

describe("CORS origin policy", () => {
  function app(origin?: string) {
    const app = new Hono();
    app.use("/api/*", createCorsMiddleware(origin));
    app.get("/api/example", (c) => c.json({ ok: true }));
    return app;
  }

  it("defaults to the request's exact origin and never emits a wildcard", async () => {
    const server = app();
    const same = await server.request("https://shelfie.example/api/example", {
      headers: { origin: "https://shelfie.example" },
    });
    const other = await server.request("https://shelfie.example/api/example", {
      headers: { origin: "https://attacker.example" },
    });
    expect(same.headers.get("access-control-allow-origin")).toBe(
      "https://shelfie.example",
    );
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("supports one configured frontend origin and its authorization preflight", async () => {
    const response = await app("http://localhost:5173").request(
      "http://localhost:3001/api/example",
      {
        method: "OPTIONS",
        headers: {
          origin: "http://localhost:5173",
          "access-control-request-method": "GET",
          "access-control-request-headers": "authorization",
        },
      },
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173",
    );
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "Authorization",
    );
  });

  it.each([
    "*",
    "https://example.com/",
    "https://example.com/path",
    "https://user:pass@example.com",
    "file:///tmp",
  ])("rejects invalid configured origins (%s)", (origin) => {
    expect(() => createCorsMiddleware(origin)).toThrow();
  });
});

describe("rate limiting", () => {
  function limitedApp(options: Parameters<typeof createRateLimit>[0]) {
    const app = new Hono();
    const check = createRateLimit(options);
    app.get("/", (c) => check(c) ?? c.text("ok"));
    return app;
  }

  it("ignores spoofed forwarding headers by default", async () => {
    const app = limitedApp({ limit: 1 });
    expect(
      (await app.request("/", { headers: { "x-forwarded-for": "1.2.3.4" } }))
        .status,
    ).toBe(200);
    const blocked = await app.request("/", {
      headers: { "x-forwarded-for": "9.8.7.6" },
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
  });

  it("uses the closest forwarded address only when trust is enabled", async () => {
    const app = limitedApp({ limit: 1, trustProxy: true });
    expect(
      (
        await app.request("/", {
          headers: { "x-forwarded-for": "spoof-a, 1.2.3.4" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request("/", {
          headers: { "x-forwarded-for": "spoof-b, 1.2.3.4" },
        })
      ).status,
    ).toBe(429);
    expect(
      (await app.request("/", { headers: { "x-forwarded-for": "1.2.3.5" } }))
        .status,
    ).toBe(200);
  });

  it("resets the window and shares a bounded overflow bucket", async () => {
    let time = 0;
    const app = limitedApp({
      limit: 1,
      trustProxy: true,
      maxAddresses: 1,
      now: () => time,
    });
    const request = (ip: string) =>
      app.request("/", { headers: { "x-forwarded-for": ip } });
    expect((await request("1.2.3.4")).status).toBe(200);
    expect((await request("1.2.3.5")).status).toBe(200);
    expect((await request("1.2.3.6")).status).toBe(429);
    time = 60_000;
    expect((await request("1.2.3.4")).status).toBe(200);
  });
});

it("only exposes known catalog GET routes", () => {
  for (const path of [
    "/api/games",
    "/api/books/search",
    "/api/games/by-slug/portal",
    "/api/tv/by-id/1",
  ]) {
    expect(isPublicCatalogRequest("GET", path)).toBe(true);
    expect(isPublicCatalogRequest("POST", path)).toBe(false);
  }
  for (const path of [
    "/api/tv/schedule",
    "/api/settings",
    "/api/sync/library_items/pull",
    "/api/movies/search/extra",
    "/api/recommendations",
  ]) {
    expect(isPublicCatalogRequest("GET", path)).toBe(false);
  }
});
