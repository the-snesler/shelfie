import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthRequestError,
  authFetch,
  getAuthToken,
  loginAccount,
  logout,
  onAuthLost,
  onAuthTokenStorageChange,
  onAuthTokenUpdated,
  setAuthToken,
} from "./auth";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("catalog authentication", () => {
  it("attaches the owner bearer token", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetch);
    setAuthToken("owner-token");
    await authFetch("/api/games/search?q=portal");
    const options = fetch.mock.calls[0][1] as RequestInit;
    expect(new Headers(options.headers).get("authorization")).toBe(
      "Bearer owner-token",
    );
  });

  it("does not trigger session loss for an anonymous request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );
    const lost = vi.fn();
    onAuthLost(lost);
    await authFetch("/api/settings");
    expect(lost).not.toHaveBeenCalled();
  });

  it("clears and announces an invalid current owner session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );
    const lost = vi.fn();
    onAuthLost(lost);
    setAuthToken("expired");
    await authFetch("/api/settings");
    expect(getAuthToken()).toBeNull();
    expect(lost).toHaveBeenCalledOnce();
  });

  it("keeps a newer session when an older request later returns 401", async () => {
    const pending = Promise.withResolvers<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending.promise));
    setAuthToken("old-token");
    const request = authFetch("/api/settings");
    setAuthToken("new-token");
    pending.resolve(new Response(null, { status: 401 }));
    await request;
    expect(getAuthToken()).toBe("new-token");
  });

  it("logs out locally immediately and preserves a subsequent login", async () => {
    const pending = Promise.withResolvers<Response>();
    const fetch = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetch);
    setAuthToken("old-token");
    const request = logout();
    expect(getAuthToken()).toBeNull();
    expect(
      new Headers((fetch.mock.calls[0][1] as RequestInit).headers).get(
        "authorization",
      ),
    ).toBe("Bearer old-token");
    setAuthToken("new-token");
    pending.resolve(new Response(null, { status: 200 }));
    await request;
    expect(getAuthToken()).toBe("new-token");
  });

  it("reports the retry time after login throttling", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(null, { status: 429, headers: { "Retry-After": "60" } }),
        ),
    );
    const request = loginAccount("owner", "password");
    await expect(request).rejects.toBeInstanceOf(AuthRequestError);
    await expect(request).rejects.toThrow("Try again in 60 seconds");
    expect(getAuthToken()).toBeNull();
  });

  it("announces same-tab token replacement after the new token is readable", () => {
    const observed: (string | null)[] = [];
    const removeListener = onAuthTokenUpdated(() =>
      observed.push(getAuthToken()),
    );
    setAuthToken("old-token");
    setAuthToken("replacement-token");
    removeListener();
    setAuthToken("later-token");
    expect(observed).toEqual(["old-token", "replacement-token"]);
  });

  it("observes cross-tab token changes and storage clearing, excluding unrelated storage", () => {
    const changed = vi.fn();
    const removeListener = onAuthTokenStorageChange(changed);
    function storage(key: string | null, storageArea: unknown = localStorage) {
      const event = new Event("storage");
      Object.defineProperties(event, {
        key: { value: key },
        storageArea: { value: storageArea },
      });
      window.dispatchEvent(event);
    }
    storage("shelfie.username");
    storage("shelfie.authToken", {});
    expect(changed).not.toHaveBeenCalled();
    storage("shelfie.authToken");
    storage(null);
    expect(changed).toHaveBeenCalledTimes(2);
    removeListener();
    storage("shelfie.authToken");
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
