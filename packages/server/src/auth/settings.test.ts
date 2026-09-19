import BetterSqlite3 from "better-sqlite3";
import { Hono } from "hono";
import { Kysely, SqliteDialect, sql } from "kysely";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/types.js";
import { runMigrations } from "../db/migrations.js";
import type * as AuthModule from "./index.js";
import type * as SettingsModule from "../settings/routes.js";

process.env.DATABASE_URL = "sqlite://:memory:";

let auth: typeof AuthModule;
let settingsRoutes: typeof SettingsModule;
let database: Kysely<Database>;
let app: Hono;

beforeAll(async () => {
  auth = await import("./index.js");
  settingsRoutes = await import("../settings/routes.js");
});

beforeEach(async () => {
  database = new Kysely<Database>({
    dialect: new SqliteDialect({ database: new BetterSqlite3(":memory:") }),
  });
  await runMigrations(database);
  app = new Hono();
  auth.registerAuthRoutes(app, database);
  app.use("/api/*", auth.createAuthMiddleware(database));
  settingsRoutes.registerSettingsRoutes(app, database);
});

afterEach(async () => {
  await database.destroy();
});

async function post(path: string, body: object, token?: string) {
  return app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function setup(): Promise<string> {
  const response = await post("/api/auth/setup", {
    username: "Sam",
    password: "old-password",
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { token: string }).token;
}

describe("owner account and settings", () => {
  it("creates defaults and matches usernames case-insensitively", async () => {
    expect(
      (
        await post("/api/auth/setup", {
          password: "old-password",
        })
      ).status,
    ).toBe(400);
    await setup();
    const wrong = await post("/api/auth/login", {
      username: "someone-else",
      password: "old-password",
    });
    const login = await post("/api/auth/login", {
      username: "sAM",
      password: "old-password",
    });

    expect(wrong.status).toBe(401);
    expect(login.status).toBe(200);
    expect(
      await database
        .selectFrom("auth_owner")
        .select(["username", "library_theme", "show_progress_bars"])
        .executeTakeFirstOrThrow(),
    ).toEqual({
      username: "Sam",
      library_theme: "classic",
      show_progress_bars: 0,
    });
  });

  it("persists validated preferences", async () => {
    const token = await setup();
    const changed = await app.request("/api/settings", {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ libraryTheme: "walnut", showProgressBars: true }),
    });
    const invalid = await app.request("/api/settings", {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ libraryTheme: "neon" }),
    });

    expect(changed.status).toBe(200);
    expect(await changed.json()).toEqual({
      username: "Sam",
      libraryTheme: "walnut",
      showProgressBars: true,
    });
    expect(invalid.status).toBe(400);
  });

  it("keeps the session on a wrong current password", async () => {
    const token = await setup();
    const changed = await post(
      "/api/auth/password",
      { currentPassword: "wrong", newPassword: "new-password" },
      token,
    );
    const settings = await app.request("/api/settings", {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(changed.status).toBe(403);
    expect(settings.status).toBe(200);
  });

  it("rotates username and password while revoking older sessions", async () => {
    const originalToken = await setup();
    const renamed = await post(
      "/api/auth/username",
      { currentPassword: "old-password", newUsername: "New Name" },
      originalToken,
    );
    const renamedToken = ((await renamed.json()) as { token: string }).token;

    expect(renamed.status).toBe(200);
    expect(
      (
        await app.request("/api/settings", {
          headers: { authorization: `Bearer ${originalToken}` },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await post("/api/auth/login", {
          username: "new name",
          password: "old-password",
        })
      ).status,
    ).toBe(200);

    const passwordChanged = await post(
      "/api/auth/password",
      { currentPassword: "old-password", newPassword: "new-password" },
      renamedToken,
    );
    const replacementToken = (
      (await passwordChanged.json()) as { token: string }
    ).token;
    expect(passwordChanged.status).toBe(200);
    expect(
      (
        await app.request("/api/settings", {
          headers: { authorization: `Bearer ${renamedToken}` },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request("/api/settings", {
          headers: { authorization: `Bearer ${replacementToken}` },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await post("/api/auth/login", {
          username: "NEW NAME",
          password: "old-password",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await post("/api/auth/login", {
          username: "NEW NAME",
          password: "new-password",
        })
      ).status,
    ).toBe(200);
  });
});

describe("owner settings migration", () => {
  it("defaults existing owners to owner/classic/hidden", async () => {
    await database.destroy();
    database = new Kysely<Database>({
      dialect: new SqliteDialect({ database: new BetterSqlite3(":memory:") }),
    });
    await sql`CREATE TABLE migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)`.execute(
      database,
    );
    await sql`CREATE TABLE auth_owner (id TEXT PRIMARY KEY, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`.execute(
      database,
    );
    for (let id = 1; id <= 9; id += 1) {
      await database
        .insertInto("migrations")
        .values({ id, name: `old-${id}`, applied_at: 1 })
        .execute();
    }
    await sql`INSERT INTO auth_owner (id, password_hash, created_at, updated_at) VALUES ('owner', 'hash', 1, 1)`.execute(
      database,
    );

    await runMigrations(database);

    expect(
      await database
        .selectFrom("auth_owner")
        .select(["username", "library_theme", "show_progress_bars"])
        .executeTakeFirstOrThrow(),
    ).toEqual({
      username: "owner",
      library_theme: "classic",
      show_progress_bars: 0,
    });
  });
});
