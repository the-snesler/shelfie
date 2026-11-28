import {
  IMPORT_BUCKETS,
  IMPORT_SOURCE_CAPABILITIES,
  type ImportConnection,
  type ImportConnectionInput,
  type ImportPolicy,
  type ImportPreview,
  type ImportSource,
} from "@tsundo/shared";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { BookMatches } from "./BookMatches";
import {
  BUCKET_HINTS,
  BUCKET_LABELS,
  ImportPolicyFields,
} from "./ImportPolicyFields";
import { buttonClass, inputClass, request } from "./importRequest";

const LABELS: Record<ImportSource, string> = {
  trakt: "Trakt",
  bookorbit: "BookOrbit",
  steam: "Steam",
};

export function ImportSources() {
  const [connections, setConnections] = useState<ImportConnection[] | null>(
    null,
  );
  const [defaults, setDefaults] = useState<ImportPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    request<ImportPolicy>("/api/imports/defaults").then(
      (policy) => {
        if (active) setDefaults(policy);
      },
      () => {
        if (active) setError("Could not load import defaults.");
      },
    );
    return () => {
      active = false;
    };
  }, []);
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
        Connect a source for one-time or scheduled imports. Choose below what
        imports bring in; each source can follow these defaults or use its own.
        Your notes and removed items are always preserved.
      </p>
      <p className="mt-2 text-xs text-muted">
        Schedules use five-field cron in UTC, for example <code>0 3 * * *</code>{" "}
        for daily at 03:00. Tsundo must be running at the scheduled time.
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
      {defaults && (
        <ImportDefaults
          defaults={defaults}
          saved={(policy) => {
            setDefaults(policy);
            // The server dropped previews made under the old defaults.
            setConnections(
              (rows) =>
                rows?.map((row) =>
                  row.policy ? row : { ...row, lastPreview: null },
                ) ?? null,
            );
          }}
        />
      )}
      {defaults &&
        connections?.map((connection) => (
          <SourceForm
            key={connection.source}
            defaults={defaults}
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

function ImportDefaults({
  defaults,
  saved,
}: {
  defaults: ImportPolicy;
  saved: (policy: ImportPolicy) => void;
}) {
  const [policy, setPolicy] = useState(defaults);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      saved(
        await request<ImportPolicy>("/api/imports/defaults", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(policy),
        }),
      );
      setMessage("Defaults saved. They apply from the next import.");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not save defaults.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="mt-5 rounded-lg border border-divider p-4">
      <summary className="cursor-pointer text-sm font-medium text-ink">
        What to import · {policySummary(defaults)}
      </summary>
      <p className="mt-3 text-xs text-muted">
        Defaults for every source without its own settings.
      </p>
      <form className="mt-4" onSubmit={(event) => void save(event)}>
        <fieldset disabled={busy} className="flex flex-col gap-3">
          <ImportPolicyFields policy={policy} onChange={setPolicy} />
          <div>
            <button className={buttonClass} type="submit">
              Save defaults
            </button>
          </div>
        </fieldset>
      </form>
      <div aria-live="polite">
        {message && <p className="mt-3 text-sm text-accent">{message}</p>}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </div>
    </details>
  );
}

function policySummary(policy: ImportPolicy): string {
  const buckets = IMPORT_BUCKETS.filter((bucket) => policy.buckets[bucket]);
  return buckets.length
    ? buckets.map((bucket) => BUCKET_LABELS[bucket].toLowerCase()).join(", ")
    : "nothing";
}

function PreviewSummary({ preview }: { preview: ImportPreview }) {
  const groups = (
    verb: string,
    byBucket: ImportPreview["added"],
  ): ReactNode[] =>
    IMPORT_BUCKETS.flatMap((bucket) => {
      const group = byBucket[bucket];
      if (!group) return [];
      const more = group.count - group.samples.length;
      return [
        <span
          key={`${verb}-${bucket}`}
          className="cursor-help underline decoration-dotted"
          title={
            group.samples.join("\n") + (more > 0 ? `\n…and ${more} more` : "")
          }
        >
          {verb} {group.count} {BUCKET_LABELS[bucket].toLowerCase()}
        </span>,
      ];
    });
  const parts = [
    ...groups("add", preview.added),
    ...groups("update", preview.updated),
  ];
  return (
    <p className="mt-2 text-sm text-muted">
      Preview ({new Date(preview.at).toLocaleString()}):{" "}
      {parts.length
        ? parts.flatMap((part, index) => (index ? [" · ", part] : [part]))
        : "no changes"}{" "}
      · {preview.filtered} left out · {preview.skipped} unchanged or skipped
    </p>
  );
}

function SourceForm({
  connection,
  defaults,
  update,
}: {
  connection: ImportConnection;
  defaults: ImportPolicy;
  update: (row: ImportConnection) => void;
}) {
  const [enabled, setEnabled] = useState(connection.enabled);
  const [schedule, setSchedule] = useState(connection.schedule || "0 3 * * *");
  const [account, setAccount] = useState(connection.account);
  const [baseUrl, setBaseUrl] = useState(connection.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [policy, setPolicy] = useState<ImportPolicy | null>(connection.policy);
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
      policy,
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

  async function start(action: "run" | "preview") {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await request(`/api/imports/${source}/${action}`, { method: "POST" });
      update(
        action === "run"
          ? { ...connection, running: true }
          : { ...connection, previewing: true },
      );
      setMessage(
        action === "run"
          ? "Import started. This page updates while it runs."
          : "Preview started. Nothing is imported; this page updates when it's ready.",
      );
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
        policy: null,
        running: false,
        previewing: false,
        lastError: null,
        lastResult: null,
        lastPreview: null,
        lastRunAt: null,
      });
      setPolicy(null);
      setEnabled(false);
      setAccount("");
      setBaseUrl("");
      setApiKey("");
      setAccessToken("");
      setMessage(
        source === "bookorbit"
          ? "Source disconnected; saved credentials and book matches removed. Imported items remain in your library."
          : "Source disconnected and saved credentials removed. Imported items remain in your library.",
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
          : connection.previewing
            ? " · Previewing…"
            : connection.enabled
              ? " · Scheduled"
              : ""}
      </summary>
      <p className="mt-3 text-xs text-muted">
        {source === "steam"
          ? "Import your public Steam library and playtime with a Steam Web API key and SteamID64. Apps without an exact IGDB mapping are skipped."
          : source === "trakt"
            ? "Import movies, TV watch history, watchlist, and ratings. Enter your profile slug and Trakt application's client ID. Private profiles also need an access token; replace it when it expires."
            : "Import reading status, progress, ratings and finish dates from BookOrbit. Create an API key in BookOrbit under Settings → API keys; read access is enough. Books are matched to Goodreads by BookOrbit's Goodreads ID, then by title and author, then ISBN."}
      </p>
      <form className="mt-4" onSubmit={(event) => void save(event)}>
        <fieldset
          disabled={busy || connection.running || connection.previewing}
          className="flex flex-col gap-3"
        >
          {source === "bookorbit" && (
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
          )}
          {source !== "bookorbit" && (
            <label className="text-sm text-muted">
              {source === "steam" ? "SteamID64" : "Trakt profile slug"}
              <input
                className={inputClass}
                required
                value={account}
                onChange={(event) => setAccount(event.currentTarget.value)}
                autoComplete="off"
              />
            </label>
          )}
          <label className="text-sm text-muted">
            {source === "steam"
              ? "Steam Web API key"
              : source === "trakt"
                ? "Trakt client ID"
                : "BookOrbit API key"}
            <input
              className={inputClass}
              type="password"
              autoComplete="new-password"
              value={apiKey}
              onChange={(event) => setApiKey(event.currentTarget.value)}
              placeholder={
                connection.hasApiKey
                  ? "Saved — leave blank to keep"
                  : source === "bookorbit"
                    ? "bok_…"
                    : "Required"
              }
              required={!connection.hasApiKey}
            />
          </label>
          {source === "trakt" && (
            <label className="text-sm text-muted">
              Access token (optional for public profiles)
              <input
                className={inputClass}
                type="password"
                autoComplete="new-password"
                value={accessToken}
                onChange={(event) => setAccessToken(event.currentTarget.value)}
                placeholder={
                  connection.hasAccessToken ? "Saved — leave blank to keep" : ""
                }
              />
            </label>
          )}
          <fieldset className="flex flex-col gap-3 rounded border border-divider p-3">
            <legend className="px-1 text-sm text-muted">What to import</legend>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={!policy}
                onChange={(event) =>
                  setPolicy(
                    event.currentTarget.checked
                      ? null
                      : structuredClone(defaults),
                  )
                }
              />
              Use the import defaults ({policySummary(defaults)})
            </label>
            {policy && (
              <ImportPolicyFields
                policy={policy}
                onChange={setPolicy}
                buckets={IMPORT_SOURCE_CAPABILITIES[source].buckets}
                mediaTypes={IMPORT_SOURCE_CAPABILITIES[source].mediaTypes}
                hints={BUCKET_HINTS[source]}
              />
            )}
            <p className="text-xs text-muted">
              Changes apply after you save the source.
            </p>
          </fieldset>
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
              onClick={() => void start("preview")}
            >
              Preview
            </button>
            <button
              className={buttonClass}
              type="button"
              disabled={!connection.hasApiKey && !connection.hasAccessToken}
              onClick={() => void start("run")}
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
      {source === "bookorbit" && connection.hasApiKey && connection.account && (
        <p className="mt-3 text-xs text-muted">
          Connected as {connection.account}
        </p>
      )}
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
          {connection.lastResult.filtered
            ? ` · ${connection.lastResult.filtered} left out`
            : ""}
        </p>
      )}
      {connection.lastPreview && (
        <PreviewSummary preview={connection.lastPreview} />
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
      {source === "bookorbit" && connection.hasApiKey && (
        <BookMatches
          source={source}
          running={connection.running}
          lastRunAt={connection.lastRunAt}
        />
      )}
    </details>
  );
}
