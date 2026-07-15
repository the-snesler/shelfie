/**
 * Twitch client-credentials token for IGDB. Client-credentials tokens live
 * for weeks, so a plain module-level cache with lazy refresh-on-expiry is
 * enough — no DB table, no background cron.
 */
interface CachedToken {
  accessToken: string;
  /** epoch ms */
  expiresAt: number;
}

let cached: CachedToken | null = null;

function requireCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.IGDB_CLIENT_ID;
  const clientSecret = process.env.IGDB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "IGDB_CLIENT_ID and IGDB_CLIENT_SECRET must be set to use the games API",
    );
  }
  return { clientId, clientSecret };
}

async function fetchToken(): Promise<CachedToken> {
  const { clientId, clientSecret } = requireCredentials();
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Twitch token request failed: ${res.status}`);
  const body = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  return {
    accessToken: body.access_token,
    // Refresh 5 min early so an in-flight request never races real expiry.
    expiresAt: Date.now() + (body.expires_in - 300) * 1000,
  };
}

/** Returns a cached bearer token, refreshing it if absent or expired. */
export async function getIgdbToken(): Promise<string> {
  if (!cached || Date.now() >= cached.expiresAt) {
    cached = await fetchToken();
  }
  return cached.accessToken;
}

/** Forces the next `getIgdbToken()` call to fetch a fresh token. */
export function invalidateIgdbToken(): void {
  cached = null;
}
