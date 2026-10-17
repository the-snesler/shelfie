import BetterSqlite3 from "better-sqlite3";
import { Hono } from "hono";
import { Kysely, SqliteDialect } from "kysely";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../db/types.js";
import { runMigrations } from "../db/migrations.js";
import type * as AuthModule from "./index.js";

process.env.DATABASE_URL = "sqlite://:memory:";
let auth: typeof AuthModule;
let database: Kysely<Database>;
let app: Hono;

beforeAll(async () => { auth = await import("./index.js"); });
beforeEach(async () => {
  database = new Kysely<Database>({ dialect: new SqliteDialect({ database: new BetterSqlite3(":memory:") }) });
  await runMigrations(database);
  app = new Hono();
  auth.registerAuthRoutes(app, database);
  app.use("/api/*", auth.createAuthMiddleware(database, { publicCatalog: true }));
  for (const path of ["/api/games/search", "/api/books/by-id/:id", "/api/movies", "/api/settings", "/api/tv/schedule", "/api/sync/library_items/stream"]) {
    app.get(path, (c) => c.json({ ok: true }));
  }
  app.post("/api/sync/library_items/push", (c) => c.json([]));
});
afterEach(async () => { await database.destroy(); });

function post(path: string, body: object) {
  return app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
async function setup() {
  const response = await post("/api/auth/setup", { username: "owner", password: "test-password" });
  expect(response.status).toBe(201);
  return ((await response.json()) as { token: string }).token;
}

describe("anonymous catalog access", () => {
  it("allows catalog reads while keeping private reads and writes behind authentication", async () => {
    expect((await app.request("/api/games/search?q=portal")).status).toBe(200);
    expect((await app.request("/api/books/by-id/1")).status).toBe(200);
    for (const path of ["/api/settings", "/api/tv/schedule", "/api/sync/library_items/stream"]) {
      expect((await app.request(path)).status).toBe(401);
    }
    expect((await post("/api/sync/library_items/push", [])).status).toBe(401);
  });

  it("shares a ten-request quota across searches and detail pages", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await app.request("/api/games/search?q=portal")).status).toBe(200);
      expect((await app.request("/api/books/by-id/1")).status).toBe(200);
    }
    const blocked = await app.request("/api/games/search?q=portal");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
  });

  it("charges each batch id and rejects oversized or invalid anonymous batches", async () => {
    expect((await app.request("/api/movies?ids=1,2,3,4,5,6,7,8,9,10,11")).status).toBe(400);
    expect((await app.request("/api/movies?ids=1,bad")).status).toBe(400);
    expect((await app.request("/api/movies?ids=1,2,3,4,5,6,7,8,9,10")).status).toBe(200);
    expect((await app.request("/api/books/by-id/1")).status).toBe(429);
  });

  it("checks bearer sessions and exempts authenticated reads from the anonymous quota", async () => {
    const token = await setup();
    for (let i = 0; i < 12; i++) {
      expect((await app.request("/api/games/search?q=portal", { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    }
    expect((await app.request("/api/books/by-id/1", { headers: { authorization: "Bearer invalid" } })).status).toBe(401);
    expect((await app.request("/api/settings", { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
  });
});

it("throttles login before the database lookup and password hashing", async () => {
  await setup();
  for (let i = 0; i < 5; i++) {
    expect((await post("/api/auth/login", { username: "wrong-user", password: "wrong-password" })).status).toBe(401);
  }
  const lookup = vi.spyOn(database, "selectFrom");
  const blocked = await post("/api/auth/login", { username: "owner", password: "test-password" });
  expect(blocked.status).toBe(429);
  expect(lookup).not.toHaveBeenCalled();
  lookup.mockRestore();
});
