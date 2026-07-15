import type { Context, Hono, MiddlewareHandler } from "hono";
import type { Kysely } from "kysely";
import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  type ScryptOptions,
  timingSafeEqual,
} from "node:crypto";
import { db as defaultDb } from "../db/index.js";
import type { Database } from "../db/types.js";

const OWNER_ID = "owner";
const TOKEN_BYTES = 32;
const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

export interface AuthStatus {
  setupRequired: boolean;
  authenticated: boolean;
}

export interface AuthTokenResponse {
  token: string;
}

interface ChangePasswordBody {
  currentPassword?: unknown;
  newPassword?: unknown;
}

interface SessionMeta {
  userAgent: string | null;
}

export function registerAuthRoutes(
  app: Hono,
  database: Kysely<Database> = defaultDb,
): void {
  app.get("/api/auth/status", async (c) => {
    const token = readToken(c);
    const setupRequired = !(await hasOwner(database));
    const authenticated = token
      ? !!(await validateSession(database, token))
      : false;
    return c.json<AuthStatus>({ setupRequired, authenticated });
  });

  app.post("/api/auth/setup", async (c) => {
    const password = await readPassword(c);
    if (!password) return c.json({ error: "password is required" }, 400);
    if (await hasOwner(database)) {
      return c.json({ error: "setup is already complete" }, 409);
    }

    try {
      const token = await createOwner(database, password, metaFromContext(c));
      return c.json<AuthTokenResponse>({ token }, 201);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return c.json({ error: "setup is already complete" }, 409);
      }
      throw err;
    }
  });

  app.post("/api/auth/login", async (c) => {
    const password = await readPassword(c);
    if (!password) return c.json({ error: "password is required" }, 400);
    const token = await login(database, password, metaFromContext(c));
    if (!token) return c.json({ error: "invalid password" }, 401);
    return c.json<AuthTokenResponse>({ token });
  });

  app.post("/api/auth/logout", async (c) => {
    const token = readToken(c);
    if (!token) return c.json({ error: "unauthorized" }, 401);
    await revokeSession(database, token);
    return c.json({ ok: true });
  });

  app.post("/api/auth/password", async (c) => {
    const token = readToken(c);
    if (!token || !(await validateSession(database, token))) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const body = await c.req.json<ChangePasswordBody>().catch(() => null);
    const currentPassword =
      typeof body?.currentPassword === "string" ? body.currentPassword : "";
    const newPassword =
      typeof body?.newPassword === "string" ? body.newPassword : "";
    if (!currentPassword || !newPassword) {
      return c.json(
        { error: "currentPassword and newPassword are required" },
        400,
      );
    }

    const nextToken = await changePassword(
      database,
      currentPassword,
      newPassword,
      metaFromContext(c),
    );
    if (!nextToken) return c.json({ error: "invalid password" }, 401);

    await revokeSession(database, token);
    return c.json<AuthTokenResponse>({ token: nextToken });
  });
}

export function createAuthMiddleware(
  database: Kysely<Database> = defaultDb,
): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.path.startsWith("/api/auth/")) {
      return next();
    }

    const token = readToken(c);
    if (!token) return c.json({ error: "unauthorized" }, 401);

    const session = await validateSession(database, token);
    if (!session) return c.json({ error: "unauthorized" }, 401);

    return next();
  };
}

async function createOwner(
  database: Kysely<Database>,
  password: string,
  meta: SessionMeta,
): Promise<string> {
  const now = Date.now();
  await database
    .insertInto("auth_owner")
    .values({
      id: OWNER_ID,
      password_hash: await hashPassword(password),
      created_at: now,
      updated_at: now,
    })
    .execute();

  return createSession(database, meta);
}

async function login(
  database: Kysely<Database>,
  password: string,
  meta: SessionMeta,
): Promise<string | null> {
  const owner = await database
    .selectFrom("auth_owner")
    .select("password_hash")
    .where("id", "=", OWNER_ID)
    .executeTakeFirst();
  if (!owner) return null;
  if (!(await verifyPassword(password, owner.password_hash))) return null;
  return createSession(database, meta);
}

async function changePassword(
  database: Kysely<Database>,
  currentPassword: string,
  newPassword: string,
  meta: SessionMeta,
): Promise<string | null> {
  const owner = await database
    .selectFrom("auth_owner")
    .select("password_hash")
    .where("id", "=", OWNER_ID)
    .executeTakeFirst();
  if (!owner) return null;
  if (!(await verifyPassword(currentPassword, owner.password_hash)))
    return null;

  const now = Date.now();
  await database
    .updateTable("auth_owner")
    .set({ password_hash: await hashPassword(newPassword), updated_at: now })
    .where("id", "=", OWNER_ID)
    .execute();
  await database
    .updateTable("auth_sessions")
    .set({ revoked_at: now })
    .where("revoked_at", "is", null)
    .execute();

  return createSession(database, meta);
}

async function createSession(
  database: Kysely<Database>,
  meta: SessionMeta,
): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const now = Date.now();
  await database
    .insertInto("auth_sessions")
    .values({
      id: randomBytes(16).toString("hex"),
      token_hash: hashToken(token),
      created_at: now,
      last_seen_at: now,
      user_agent: meta.userAgent,
      revoked_at: null,
    })
    .execute();
  return token;
}

async function hasOwner(database: Kysely<Database>): Promise<boolean> {
  const row = await database
    .selectFrom("auth_owner")
    .select("id")
    .where("id", "=", OWNER_ID)
    .executeTakeFirst();
  return !!row;
}

async function validateSession(
  database: Kysely<Database>,
  token: string,
): Promise<boolean> {
  const tokenHash = hashToken(token);
  const session = await database
    .selectFrom("auth_sessions")
    .select(["id", "revoked_at"])
    .where("token_hash", "=", tokenHash)
    .executeTakeFirst();
  if (!session || session.revoked_at !== null) return false;

  await database
    .updateTable("auth_sessions")
    .set({ last_seen_at: Date.now() })
    .where("id", "=", session.id)
    .execute();
  return true;
}

async function revokeSession(
  database: Kysely<Database>,
  token: string,
): Promise<void> {
  await database
    .updateTable("auth_sessions")
    .set({ revoked_at: Date.now() })
    .where("token_hash", "=", hashToken(token))
    .where("revoked_at", "is", null)
    .execute();
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derived = await deriveKey(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  return [
    "scrypt",
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt,
    derived.toString("base64url"),
  ].join("$");
}

async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await deriveKey(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function deriveKey(
  password: string,
  salt: string,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  scryptCallback(password, salt, keylen, options, (err, derivedKey) => {
    if (err) reject(err);
    else resolve(derivedKey);
  });
  return promise;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function readToken(c: Context): string | null {
  const header = c.req.header("authorization");
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length);
  return c.req.query("token") ?? null;
}

async function readPassword(c: Context): Promise<string | null> {
  const body = await c.req.json<{ password?: unknown }>().catch(() => null);
  return typeof body?.password === "string" && body.password.length > 0
    ? body.password
    : null;
}

function metaFromContext(c: Context): SessionMeta {
  return { userAgent: c.req.header("user-agent") ?? null };
}

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Error && /unique|constraint/i.test(err.message);
}
