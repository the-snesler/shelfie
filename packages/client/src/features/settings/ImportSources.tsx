import type {
  ImportConnection,
  ImportConnectionInput,
  ImportSource,
} from "@shelfie/shared";
import { useEffect, useState, type FormEvent } from "react";
import { authFetch } from "../../auth";

const LABELS: Record<ImportSource, string> = {
  trakt: "Trakt",
  bookorbit: "BookOrbit",
  steam: "Steam",
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(path, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export function ImportSources() {
  const [connections, setConnections] = useState<ImportConnection[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const rows = await request<ImportConnection[]>("/api/imports");
        if (active) {
          setConnections(rows);
          setError(null);
        }
      } catch {
        if (active) setError("Could not load import sources.");
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <section className="rounded-xl border border-divider bg-panel p-5 shadow">
      <h2 className="font-display text-xl font-medium text-ink">
        Import sources
      </h2>
      <p className="mt-3 text-sm text-muted">
        Connect a source for one-time or scheduled imports. Imports add missing
        items and fill missing ratings, watch history, and progress. Your
        existing statuses, notes, and removed items are preserved.
      </p>
      <p className="mt-2 text-xs text-muted">
        Schedules use five-field cron in UTC, for example <code>0 3 * * *</code>{" "}
        for daily at 03:00. Shelfie must be running at the scheduled time.
        Credentials are saved only on this server.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      {!connections && !error && (
        <p className="mt-3 text-sm text-muted">Loading sources…</p>
      )}
      {connections?.map((connection) => (
        <SourceForm
          key={connection.source}
          connection={connection}
          update={(row) =>
            setConnections(
              (rows) =>
                rows?.map((old) => (old.source === row.source ? row : old)) ??
                null,
            )
          }
        />
      ))}
    </section>
  );
}

function SourceForm({
  connection,
  update,
}: {
  connection: ImportConnection;
  update: (row: ImportConnection) => void;
}) {
  const [enabled, setEnabled] = useState(connection.enabled);
  const [schedule, setSchedule] = useState(connection.schedule || "0 3 * * *");
  const [account, setAccount] = useState(connection.account);
  const [baseUrl, setBaseUrl] = useState(connection.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { source } = connection;

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    const input: ImportConnectionInput = {
      enabled,
      schedule: enabled ? schedule : "",
      account,
      baseUrl,
      ...(apiKey ? { apiKey } : {}),
      ...(accessToken ? { accessToken } : {}),
    };
    try {
      update(
        await request<ImportConnection>(`/api/imports/${source}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        }),
      );
      setApiKey("");
      setAccessToken("");
      setMessage("Source saved. Use Import now to start an import.");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not save source.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await request(`/api/imports/${source}/run`, { method: "POST" });
      update({ ...connection, running: true });
      setMessage("Import started. This page updates while it runs.");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not start import.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await request(`/api/imports/${source}`, { method: "DELETE" });
      update({
        ...connection,
        enabled: false,
        schedule: "",
        account: "",
        baseUrl: "",
        hasApiKey: false,
        hasAccessToken: false,
        running: false,
        lastError: null,
        lastResult: null,
        lastRunAt: null,
      });
      setEnabled(false);
      setAccount("");
      setBaseUrl("");
      setApiKey("");
      setAccessToken("");
      setMessage(
        "Source disconnected and saved credentials removed. Imported items remain in your library.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not disconnect source.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="mt-5 rounded-lg border border-divider p-4">
      <summary className="cursor-pointer text-sm font-medium text-ink">
        {LABELS[source]}
        {connection.running
          ? " · Importing…"
          : connection.enabled
            ? " · Scheduled"
            : ""}
      </summary>
      <p className="mt-3 text-xs text-muted">
        {source === "steam"
          ? "Import your public Steam library and playtime with a Steam Web API key and SteamID64. Apps without an exact IGDB mapping are skipped."
          : source === "trakt"
            ? "Import movies, TV watch history, watchlist, and ratings. Enter your profile slug and Trakt application's client ID. Private profiles also need an access token; replace it when it expires."
            : "Connect to a BookOrbit server with a bearer access token. Books need a Goodreads provider ID in BookOrbit. Replace the token when it expires."}
      </p>
      <form className="mt-4" onSubmit={(event) => void save(event)}>
        <fieldset
          disabled={busy || connection.running}
          className="flex flex-col gap-3"
        >
          {source === "bookorbit" ? (
            <label className="text-sm text-muted">
              BookOrbit server URL
              <input
                className={inputClass}
                type="url"
                required
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.currentTarget.value)}
                placeholder="http://bookorbit:3000"
              />
            </label>
          ) : (
            <label className="text-sm text-muted">
              {source === "steam" ? "SteamID64" : "Trakt profile slug"}
              <input
                className={inputClass}
                required
                value={account}
                onChange={(event) => setAccount(event.currentTarget.value)}
              />
            </label>
          )}
          {source !== "bookorbit" && (
            <label className="text-sm text-muted">
              {source === "steam" ? "Steam Web API key" : "Trakt client ID"}
              <input
                className={inputClass}
                type="password"
                autoComplete="new-password"
                value={apiKey}
                onChange={(event) => setApiKey(event.currentTarget.value)}
                placeholder={
                  connection.hasApiKey
                    ? "Saved — leave blank to keep"
                    : "Required"
                }
                required={!connection.hasApiKey}
              />
            </label>
          )}
          {source !== "steam" && (
            <label className="text-sm text-muted">
              {source === "bookorbit"
                ? "Bearer access token"
                : "Access token (optional for public profiles)"}
              <input
                className={inputClass}
                type="password"
                autoComplete="new-password"
                value={accessToken}
                onChange={(event) => setAccessToken(event.currentTarget.value)}
                placeholder={
                  connection.hasAccessToken ? "Saved — leave blank to keep" : ""
                }
                required={source === "bookorbit" && !connection.hasAccessToken}
              />
            </label>
          )}
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.currentTarget.checked)}
            />
            Run periodically
          </label>
          {enabled && (
            <label className="text-sm text-muted">
              Cron schedule (UTC)
              <input
                className={inputClass}
                value={schedule}
                required
                onChange={(event) => setSchedule(event.currentTarget.value)}
              />
            </label>
          )}
          <div className="flex flex-wrap gap-3">
            <button className={buttonClass} type="submit">
              Save source
            </button>
            <button
              className={buttonClass}
              type="button"
              disabled={!connection.hasApiKey && !connection.hasAccessToken}
              onClick={() => void run()}
            >
              Import now
            </button>
            <button
              className={buttonClass}
              type="button"
              onClick={() => void disconnect()}
              disabled={!connection.hasApiKey && !connection.hasAccessToken}
            >
              Disconnect
            </button>
          </div>
        </fieldset>
      </form>
      {connection.lastRunAt && (
        <p className="mt-3 text-xs text-muted">
          Last started {new Date(connection.lastRunAt).toLocaleString()}
          {connection.running ? " · Running" : ""}
        </p>
      )}
      {connection.lastResult && (
        <p className="mt-2 text-sm text-muted">
          {connection.lastResult.added} added · {connection.lastResult.updated}{" "}
          updated · {connection.lastResult.skipped} skipped
        </p>
      )}
      {connection.lastResult?.warnings.map((warning) => (
        <p key={warning} className="mt-2 text-xs text-muted">
          {warning}
        </p>
      ))}
      <div aria-live="polite">
        {message && <p className="mt-3 text-sm text-accent">{message}</p>}
        {(error || connection.lastError) && (
          <p className="mt-3 text-sm text-danger">
            {error ?? connection.lastError}
          </p>
        )}
      </div>
    </details>
  );
}

const inputClass =
  "mt-1 w-full rounded bg-bg px-3 py-2 text-ink outline-none ring-1 ring-divider focus:ring-accent";
const buttonClass =
  "inline-flex items-center rounded border border-divider bg-well px-3 py-2 text-sm font-medium text-ink hover:border-muted disabled:cursor-not-allowed disabled:opacity-50";
