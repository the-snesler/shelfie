import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, MiddlewareHandler } from "hono";
import { cors } from "hono/cors";

/** Forwarding headers are untrusted unless the operator enables one trusted
 * reverse proxy. Use the closest forwarded address, never a client-supplied
 * first entry in an appended X-Forwarded-For chain. */
export function clientAddress(c: Context, trustProxy = false): string {
  if (trustProxy) {
    const forwarded = c.req
      .header("x-forwarded-for")
      ?.split(",")
      .at(-1)
      ?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    // In-process requests have no socket. Share a bucket rather than trust
    // arbitrary headers or create a new identity on each request.
    return "unknown";
  }
}

interface Bucket {
  used: number;
  resetAt: number;
}

/** In-memory, bounded fixed windows for this single-process application. */
export function createRateLimit({
  limit,
  windowMs = 60_000,
  trustProxy = false,
  now = Date.now,
  maxAddresses = 10_000,
}: {
  limit: number;
  windowMs?: number;
  trustProxy?: boolean;
  now?: () => number;
  maxAddresses?: number;
}): (c: Context, cost?: number) => Response | undefined {
  const buckets = new Map<string, Bucket>();
  let nextSweep = 0;
  return (c, cost = 1) => {
    const time = now();
    if (time >= nextSweep) {
      for (const [key, bucket] of buckets) {
        if (time >= bucket.resetAt) buckets.delete(key);
      }
      nextSweep = time + windowMs;
    }
    let key = clientAddress(c, trustProxy);
    // A flood of distinct addresses cannot cause unbounded memory or evict
    // an existing client's quota. New addresses share the overflow window.
    if (!buckets.has(key) && buckets.size >= maxAddresses) key = "overflow";
    let bucket = buckets.get(key);
    if (!bucket || time >= bucket.resetAt) {
      bucket = { used: 0, resetAt: time + windowMs };
      buckets.set(key, bucket);
    }
    if (bucket.used + cost > limit) {
      c.header(
        "Retry-After",
        String(Math.ceil((bucket.resetAt - time) / 1000)),
      );
      c.header("Cache-Control", "no-store");
      return c.json(
        { error: "Too many requests. Please try again shortly." },
        429,
      );
    }
    bucket.used += cost;
  };
}

export function createCorsMiddleware(origin?: string): MiddlewareHandler {
  let configured: string | undefined;
  if (origin) {
    const parsed = new URL(origin);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.origin !== origin ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error(
        "CORS_ORIGIN must be one exact HTTP(S) origin, without a path or trailing slash",
      );
    }
    configured = parsed.origin;
  }
  return cors({
    origin: (requestOrigin, c) =>
      requestOrigin === (configured ?? new URL(c.req.url).origin)
        ? requestOrigin
        : "",
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type"],
    maxAge: 600,
  });
}

/** Only catalog search, card batches and detail reads are public. Scheduling,
 * recommendations, settings and the entire sync protocol remain private. */
export function isPublicCatalogRequest(method: string, path: string): boolean {
  return (
    method === "GET" &&
    (/^\/api\/(games|movies|tv|books)$/.test(path) ||
      /^\/api\/(games|movies|tv|books)\/search$/.test(path) ||
      /^\/api\/games\/by-slug\/[^/]+$/.test(path) ||
      /^\/api\/(movies|tv|books)\/by-id\/[^/]+$/.test(path))
  );
}
