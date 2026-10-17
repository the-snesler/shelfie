import type { AuthStatus } from "./auth";

export interface AuthSessionState {
  mode: "checking" | "setup" | "app" | "guest" | "unreachable";
  setupRequired?: boolean;
}

/** Owns status checks across retries and tab changes. A response can only
 * change the session that requested it; later checks and local sign-in/out
 * actions invalidate earlier responses even when their tokens match. */
export function createAuthSessionMonitor({
  readToken,
  readStatus,
  clearToken,
  stopSync,
  onState,
}: {
  readToken: () => string | null;
  readStatus: () => Promise<AuthStatus>;
  clearToken: () => void;
  stopSync: () => void;
  onState: (state: AuthSessionState) => void;
}) {
  let generation = 0;
  let disposed = false;

  function invalidate() {
    generation++;
  }

  async function check({ allowOffline = false } = {}) {
    const request = ++generation;
    const expectedToken = readToken();
    const current = () =>
      !disposed && request === generation && readToken() === expectedToken;
    try {
      const status = await readStatus();
      if (!current()) return;
      if (status.authenticated && expectedToken) {
        onState({ mode: "app", setupRequired: status.setupRequired });
      } else {
        clearToken();
        stopSync();
        onState({
          mode: status.setupRequired ? "setup" : "guest",
          setupRequired: status.setupRequired,
        });
      }
    } catch {
      if (current()) {
        // Sessions established in this tab can keep their offline library.
        // A token newly received from another tab must validate first.
        onState({
          mode: allowOffline && expectedToken ? "app" : "unreachable",
        });
      }
    }
  }

  async function storageChanged() {
    invalidate();
    stopSync();
    if (!readToken()) {
      onState({ mode: "guest" });
      return;
    }
    onState({ mode: "checking" });
    await check();
  }

  return {
    check,
    storageChanged,
    invalidate,
    dispose() {
      disposed = true;
      invalidate();
    },
  };
}
