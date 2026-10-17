import { describe, expect, it, vi } from "vitest";
import type { AuthStatus } from "./auth";
import { createAuthSessionMonitor, type AuthSessionState } from "./authSession";

function session(initialToken: string | null = "old-token") {
  let token = initialToken;
  let state: AuthSessionState = { mode: initialToken ? "app" : "guest" };
  const requests: ReturnType<typeof Promise.withResolvers<AuthStatus>>[] = [];
  const stopSync = vi.fn();
  const clearToken = vi.fn(() => {
    token = null;
  });
  const monitor = createAuthSessionMonitor({
    readToken: () => token,
    readStatus: () => {
      const request = Promise.withResolvers<AuthStatus>();
      requests.push(request);
      return request.promise;
    },
    clearToken,
    stopSync,
    onState: (next) => {
      state = next;
    },
  });
  return {
    monitor,
    requests,
    stopSync,
    clearToken,
    replaceToken(next: string | null) {
      token = next;
    },
    get token() {
      return token;
    },
    get state() {
      return state;
    },
  };
}

const valid: AuthStatus = { authenticated: true, setupRequired: false };
const invalid: AuthStatus = { authenticated: false, setupRequired: false };

describe("session checks across sign-in, logout and retries", () => {
  it("ignores a rejected old token after a same-tab password change or new login", async () => {
    const owner = session();
    const checking = owner.monitor.check();
    owner.replaceToken("replacement-token");
    owner.requests[0].resolve(invalid);
    await checking;
    expect(owner.token).toBe("replacement-token");
    expect(owner.state.mode).toBe("app");
    expect(owner.clearToken).not.toHaveBeenCalled();
  });

  it("keeps the newer retry result when a previous check arrives later", async () => {
    const owner = session();
    const previous = owner.monitor.check();
    const retry = owner.monitor.check();
    owner.requests[1].resolve(valid);
    await retry;
    owner.requests[0].resolve(invalid);
    await previous;
    expect(owner.token).toBe("old-token");
    expect(owner.state.mode).toBe("app");
    expect(owner.clearToken).not.toHaveBeenCalled();
  });

  it("does not reopen the owner app when an in-flight check finishes after logout", async () => {
    const owner = session();
    const checking = owner.monitor.check();
    owner.replaceToken(null);
    await owner.monitor.storageChanged();
    expect(owner.state.mode).toBe("guest");
    expect(owner.stopSync).toHaveBeenCalledOnce();
    owner.requests[0].resolve(valid);
    await checking;
    expect(owner.state.mode).toBe("guest");
  });

  it("invalidates pending checks when the user explicitly leaves sign-in", async () => {
    const owner = session(null);
    const checking = owner.monitor.check();
    owner.monitor.invalidate();
    owner.requests[0].resolve({ authenticated: false, setupRequired: true });
    await checking;
    expect(owner.state.mode).toBe("guest");
    expect(owner.clearToken).not.toHaveBeenCalled();
  });
});

describe("cross-tab token transitions", () => {
  it("stops sync immediately and validates a token received from another tab", async () => {
    const owner = session(null);
    owner.replaceToken("another-tab-token");
    const checking = owner.monitor.storageChanged();
    expect(owner.stopSync).toHaveBeenCalledOnce();
    expect(owner.state.mode).toBe("checking");
    owner.requests[0].resolve(valid);
    await checking;
    expect(owner.state.mode).toBe("app");
    expect(owner.token).toBe("another-tab-token");
  });

  it("removes an invalid token received from another tab", async () => {
    const owner = session();
    owner.replaceToken("revoked-token");
    const checking = owner.monitor.storageChanged();
    expect(owner.state.mode).toBe("checking");
    owner.requests[0].resolve(invalid);
    await checking;
    expect(owner.state.mode).toBe("guest");
    expect(owner.token).toBeNull();
  });

  it("finishes validation when a same-tab credential change replaces a token being checked", async () => {
    const owner = session(null);
    owner.replaceToken("another-tab-token");
    const earlier = owner.monitor.storageChanged();
    owner.replaceToken("password-change-token");
    const replacement = owner.monitor.check({ allowOffline: true });
    owner.requests[1].resolve(valid);
    await replacement;
    owner.requests[0].resolve(invalid);
    await earlier;
    expect(owner.state.mode).toBe("app");
    expect(owner.token).toBe("password-change-token");
    expect(owner.clearToken).not.toHaveBeenCalled();
  });

  it("preserves initial offline access but requires validation of a new cross-tab token", async () => {
    const owner = session();
    const initial = owner.monitor.check({ allowOffline: true });
    owner.requests[0].reject(new Error("offline"));
    await initial;
    expect(owner.state.mode).toBe("app");
    owner.replaceToken("another-tab-token");
    const added = owner.monitor.storageChanged();
    owner.requests[1].reject(new Error("offline"));
    await added;
    expect(owner.state.mode).toBe("unreachable");
  });

  it("does not apply an old token's validation after another tab removes it", async () => {
    const owner = session(null);
    owner.replaceToken("another-tab-token");
    const checking = owner.monitor.storageChanged();
    owner.replaceToken(null);
    await owner.monitor.storageChanged();
    owner.requests[0].resolve(valid);
    await checking;
    expect(owner.state.mode).toBe("guest");
    expect(owner.token).toBeNull();
  });

  it("does not mutate a session after its App instance unmounts", async () => {
    const owner = session();
    const checking = owner.monitor.check();
    owner.monitor.dispose();
    owner.requests[0].resolve(invalid);
    await checking;
    expect(owner.clearToken).not.toHaveBeenCalled();
    expect(owner.token).toBe("old-token");
  });
});
