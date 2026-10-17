const TOKEN_KEY = "shelfie.authToken";
const USERNAME_KEY = "shelfie.username";
const AUTH_LOST_EVENT = "shelfie-auth-lost";
const TOKEN_UPDATED_EVENT = "shelfie-auth-token-updated";

export interface AuthStatus {
  setupRequired: boolean;
  authenticated: boolean;
}

interface TokenResponse {
  token: string;
}

export class AuthRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  // Native storage events only reach other tabs. Local credential changes
  // also supersede any pending status check for the old token.
  window.dispatchEvent(new Event(TOKEN_UPDATED_EVENT));
}

export function clearAuthToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function getRememberedUsername(): string {
  return localStorage.getItem(USERNAME_KEY) ?? "owner";
}

export function rememberUsername(username: string): void {
  localStorage.setItem(USERNAME_KEY, username);
}

export function onAuthLost(handler: () => void): () => void {
  window.addEventListener(AUTH_LOST_EVENT, handler);
  return () => window.removeEventListener(AUTH_LOST_EVENT, handler);
}

/** Storage events are delivered to the other tabs sharing this origin.
 * A null key represents localStorage.clear(), which also removes the token. */
export function onAuthTokenStorageChange(handler: () => void): () => void {
  const listener = (event: StorageEvent) => {
    if (
      event.storageArea === localStorage &&
      (event.key === TOKEN_KEY || event.key === null)
    )
      handler();
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

export function onAuthTokenUpdated(handler: () => void): () => void {
  window.addEventListener(TOKEN_UPDATED_EVENT, handler);
  return () => window.removeEventListener(TOKEN_UPDATED_EVENT, handler);
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const headers = new Headers();
  const token = getAuthToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const res = await fetch("/api/auth/status", { headers });
  if (!res.ok) throw new Error(`status failed: ${res.status}`);
  return res.json() as Promise<AuthStatus>;
}

export async function setupAccount(
  username: string,
  password: string,
): Promise<string> {
  const body = await requestToken("/api/auth/setup", username, password);
  setAuthToken(body.token);
  rememberUsername(username.trim());
  return body.token;
}

export async function loginAccount(
  username: string,
  password: string,
): Promise<string> {
  const body = await requestToken("/api/auth/login", username, password);
  setAuthToken(body.token);
  rememberUsername(username.trim());
  return body.token;
}

export async function logout(): Promise<void> {
  const request = authFetch("/api/auth/logout", { method: "POST" });
  clearAuthToken();
  await request.catch(() => {});
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<string> {
  const res = await authFetch("/api/auth/password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}`,
    );
  }

  const body = (await res.json()) as TokenResponse;
  setAuthToken(body.token);
  return body.token;
}

export async function changeUsername(
  currentPassword: string,
  newUsername: string,
): Promise<string> {
  const res = await authFetch("/api/auth/username", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ currentPassword, newUsername }),
  });
  if (!res.ok) throw new Error(await responseError(res));

  const body = (await res.json()) as TokenResponse;
  setAuthToken(body.token);
  rememberUsername(newUsername.trim());
  return body.token;
}

/** The fetch wrapper every `/api/*` call must go through — attaches the
 * bearer token and reacts to a lost session. Calling `fetch` directly for
 * anything under `/api/*` silently skips both. */
export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getAuthToken();
  if (token && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${token}`);
  }

  const res = await fetch(input, { ...init, headers });
  // Only 401 means "session lost" -> drop the token and bounce to login. A
  // 403 is "authenticated but forbidden", which must not log the user out.
  if (res.status === 401 && token && getAuthToken() === token) {
    clearAuthToken();
    window.dispatchEvent(new Event(AUTH_LOST_EVENT));
  }
  return res;
}

/** Appends the token as a `?token=` query param — used only for the SSE
 * `EventSource` URL, since `EventSource` cannot set headers. */
export function authUrl(path: string): string {
  const token = getAuthToken();
  if (!token) return path;
  const url = new URL(path, window.location.origin);
  url.searchParams.set("token", token);
  return `${url.pathname}${url.search}${url.hash}`;
}

async function requestToken(
  url: string,
  username: string,
  password: string,
): Promise<TokenResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    if (res.status === 429) {
      const retry = res.headers.get("Retry-After");
      throw new AuthRequestError(
        429,
        `Too many attempts. Try again${retry ? ` in ${retry} seconds` : " shortly"}.`,
      );
    }
    const detail = await res.text().catch(() => "");
    throw new Error(
      `${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}`,
    );
  }
  return res.json() as Promise<TokenResponse>;
}

async function responseError(res: Response): Promise<string> {
  const detail = await res.text().catch(() => "");
  return `${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}`;
}
