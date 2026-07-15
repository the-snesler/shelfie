import type React from "react";
import { useState } from "react";
import type { AuthMode } from "./App";
import { loginPassword, setupPassword } from "./auth";

export function AuthScreen({
  mode,
  onRetry,
  onAuthenticated,
}: {
  mode: AuthMode;
  onRetry: () => void;
  onAuthenticated: () => void;
}) {
  const isSetup = mode === "setup";
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (isSetup) await setupPassword(password);
      else await loginPassword(password);
      setPassword("");
      onAuthenticated();
    } catch {
      setError(isSetup ? "Could not create password." : "Incorrect password.");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "checking") {
    return (
      <div className="flex h-full items-center justify-center bg-bg text-muted">
        Loading…
      </div>
    );
  }

  if (mode === "unreachable") {
    return (
      <div className="flex h-full items-center justify-center bg-bg px-4">
        <div className="w-full max-w-sm rounded border border-divider bg-panel p-5 shadow">
          <h1 className="text-lg font-semibold text-ink">Server unavailable</h1>
          <p className="mt-2 text-sm text-muted">
            Start the server, then try again.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 w-full rounded bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center bg-bg px-4">
      <form
        onSubmit={(e) => void submit(e)}
        className="w-full max-w-sm rounded-xl border border-divider bg-panel p-8 shadow"
      >
        <h1 className="text-center text-2xl font-semibold text-ink">Shelfie</h1>
        <p className="mt-1 text-center text-sm text-muted">
          {isSetup ? "Create a password to get started." : "Welcome back"}
        </p>
        <label className="mt-6 block text-sm font-medium text-muted">
          Password
          <input
            autoFocus
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded bg-bg px-3 py-2 text-ink outline-none ring-1 ring-divider focus:ring-accent"
          />
        </label>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={!password || busy}
          className="mt-4 w-full rounded bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Working…" : isSetup ? "Create" : "Log in"}
        </button>
      </form>
    </div>
  );
}
