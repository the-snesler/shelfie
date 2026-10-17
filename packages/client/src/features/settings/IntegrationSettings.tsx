import type {
  CalendarSubscriptionSettings,
  CreatedCalendarSubscription,
  NotificationSettings,
} from "@shelfie/shared";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { authFetch } from "../../auth";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(path, init);
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(error?.error ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function CalendarSubscriptionSection() {
  const [settings, setSettings] = useState<CalendarSubscriptionSettings | null>(
    null,
  );
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void request<CalendarSubscriptionSettings>("/api/settings/calendar").then(
      (result) => {
        if (active) setSettings(result);
      },
      () => {
        if (active) setError("Could not load calendar subscription settings.");
      },
    );
    return () => {
      active = false;
    };
  }, []);

  async function change(create: boolean) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (create) {
        const result = await request<CreatedCalendarSubscription>(
          "/api/settings/calendar",
          { method: "POST" },
        );
        setSettings(result);
        setUrl(new URL(result.path, window.location.origin).href);
        setMessage(
          "Subscription URL created. Previous subscription URLs are now revoked.",
        );
      } else {
        setSettings(
          await request<CalendarSubscriptionSettings>(
            "/api/settings/calendar",
            { method: "DELETE" },
          ),
        );
        setUrl(null);
        setMessage("Calendar subscription revoked.");
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not update calendar subscription.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Calendar subscription">
      <p className="text-sm text-muted">
        Add your collection’s releases, TV air dates, and completion history to
        a calendar app by URL. Dates come from Shelfie’s cached metadata and
        update when your calendar app refreshes the subscription.
      </p>
      <p className="mt-2 text-xs text-muted">
        Anyone with this private URL can read the calendar. Generating a
        replacement or revoking it disables the previous URL.
      </p>
      {url && (
        <label className="mt-4 block text-sm text-muted">
          Private subscription URL — copy it now
          <input
            aria-label="Private calendar subscription URL"
            readOnly
            value={url}
            onFocus={(event) => event.currentTarget.select()}
            className={inputClass}
          />
        </label>
      )}
      {settings?.enabled && !url && (
        <p className="mt-3 text-sm text-muted">
          A subscription is active. Generate a replacement to reveal a new
          private URL.
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          className={buttonClass}
          disabled={busy || !settings}
          onClick={() => void change(true)}
        >
          {settings?.enabled
            ? "Generate replacement URL"
            : "Create subscription URL"}
        </button>
        {settings?.enabled && (
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() => void change(false)}
          >
            Revoke subscription
          </button>
        )}
      </div>
      <Feedback message={message} error={error} />
    </Section>
  );
}

export function ReleaseNotificationsSection() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [destinations, setDestinations] = useState("");
  const [daysBefore, setDaysBefore] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void request<NotificationSettings>("/api/settings/notifications").then(
      (result) => {
        if (!active) return;
        setSettings(result);
        setEnabled(result.enabled);
        setEndpoint(result.endpoint);
        setDaysBefore(result.daysBefore);
      },
      () => {
        if (active) setError("Could not load notification settings.");
      },
    );
    return () => {
      active = false;
    };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await request<NotificationSettings>(
        "/api/settings/notifications",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            enabled,
            endpoint,
            daysBefore,
            ...(destinations.trim() ? { destinations } : {}),
          }),
        },
      );
      setSettings(result);
      setDestinations("");
      setEndpoint(result.endpoint);
      setMessage("Notification settings saved.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save notification settings.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await request("/api/settings/notifications/test", { method: "POST" });
      setMessage("Test notification sent to your saved destinations.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not send the test notification.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Release notifications">
      <p className="text-sm text-muted">
        Use an{" "}
        <a
          href="https://appriseit.com/api/"
          target="_blank"
          rel="noreferrer"
          className="text-accent underline"
        >
          Apprise API server
        </a>{" "}
        to receive reminders for releases and TV episodes in your collection.
        Shelfie checks cached dates each minute, using UTC days. Keep Shelfie
        running to receive reminders.
      </p>
      <form className="mt-4" onSubmit={(event) => void save(event)}>
        <fieldset disabled={busy || !settings} className="flex flex-col gap-4">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.currentTarget.checked)}
              className="size-4 accent-[var(--color-accent)]"
            />
            Enable release reminders
          </label>
          <label className="block text-sm text-muted">
            Apprise API base URL
            <input
              type="url"
              value={endpoint}
              maxLength={2048}
              placeholder="http://apprise:8000"
              onChange={(event) => setEndpoint(event.currentTarget.value)}
              className={inputClass}
            />
          </label>
          <label className="block text-sm text-muted">
            Destination URLs, one per line
            <textarea
              value={destinations}
              rows={3}
              maxLength={16000}
              autoComplete="off"
              placeholder={
                settings?.destinationsConfigured
                  ? "Saved destinations are hidden. Leave blank to keep them."
                  : "ntfy://ntfy.sh/your-topic"
              }
              onChange={(event) => setDestinations(event.currentTarget.value)}
              className={inputClass}
            />
            <span className="mt-1 block text-xs">
              Saving replacement URLs replaces all saved destinations.
            </span>
          </label>
          <label className="block text-sm text-muted">
            Days before release (0 means release day)
            <input
              type="number"
              min={0}
              max={30}
              step={1}
              value={daysBefore}
              onChange={(event) =>
                setDaysBefore(Number(event.currentTarget.value))
              }
              className={inputClass}
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button type="submit" className={buttonClass}>
              {busy ? "Saving…" : "Save notifications"}
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={!settings?.destinationsConfigured || !settings.endpoint}
              onClick={() => void test()}
            >
              Send test to saved destinations
            </button>
          </div>
        </fieldset>
      </form>
      {settings && (
        <p className="mt-3 text-xs text-muted">
          {settings.pending} pending · {settings.failed} failed or cancelled
          {settings.lastSentAt
            ? ` · Last sent ${new Date(settings.lastSentAt).toLocaleString()}`
            : ""}
        </p>
      )}
      <Feedback message={message} error={error} />
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-divider bg-panel p-5 shadow">
      <h2 className="font-display text-xl font-medium text-ink">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Feedback({
  message,
  error,
}: {
  message: string | null;
  error: string | null;
}) {
  return (
    <div aria-live="polite">
      {message && <p className="mt-3 text-sm text-accent">{message}</p>}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </div>
  );
}

const inputClass =
  "mt-1 w-full rounded bg-bg px-3 py-2 text-ink outline-none ring-1 ring-divider focus:ring-accent";
const buttonClass =
  "inline-flex items-center gap-2 rounded border border-divider bg-well px-3 py-2 text-sm font-medium text-ink hover:border-muted disabled:cursor-not-allowed disabled:opacity-50";
