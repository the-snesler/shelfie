import {
  LIBRARY_THEMES,
  type LibraryTheme,
  type OwnerSettings,
} from "@shelfie/shared";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useOutletContext } from "react-router";
import IconDownload from "~icons/tabler/download";
import IconUpload from "~icons/tabler/upload";
import type { AppOutletContext } from "../../App";
import { changePassword, changeUsername } from "../../auth";
import { updatePreferences } from "../../settings";
import {
  exportLibraryCsv,
  importLibraryCsv,
  prepareLibraryImport,
} from "./libraryCsv";

const THEME_LABELS: Record<LibraryTheme, string> = {
  classic: "Classic",
  black: "Black",
  oak: "Oak",
  walnut: "Walnut",
};

const THEME_COLORS: Record<LibraryTheme, string> = {
  classic: "bg-[#372f29]",
  black: "bg-[#171717]",
  oak: "bg-[#9b6a3d]",
  walnut: "bg-[#5c3827]",
};

export default function Settings() {
  const { db, settings, setSettings } = useOutletContext<AppOutletContext>();
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [savingPreference, setSavingPreference] = useState(false);
  const [dataMessage, setDataMessage] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function savePreferences(
    patch: Parameters<typeof updatePreferences>[0],
  ) {
    setSavingPreference(true);
    setPreferenceError(null);
    try {
      setSettings(await updatePreferences(patch));
    } catch {
      setPreferenceError("Could not save that preference.");
    } finally {
      setSavingPreference(false);
    }
  }

  async function exportCsv() {
    setDataError(null);
    setDataMessage(null);
    try {
      const items = await db.library_items.find().exec();
      const csv = exportLibraryCsv(items);
      const blob = new Blob(["\uFEFF", csv], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `shelfie-library-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setDataMessage(`Exported ${items.length} items.`);
    } catch {
      setDataError("Could not export your library.");
    }
  }

  async function importCsv(file: File) {
    setImporting(true);
    setDataError(null);
    setDataMessage(null);
    try {
      const imported = importLibraryCsv(await file.text());
      const ids = imported.map((item) => item.id);
      const found = await db.library_items.findByIds(ids).exec();
      const existing = new Map(
        [...found].map(([id, item]) => [id, item] as const),
      );
      const prepared = prepareLibraryImport(imported, existing);
      const result = await db.library_items.bulkUpsert(prepared.documents);
      if (result.error.length > 0) {
        throw new Error("The database rejected one or more rows.");
      }
      setDataMessage(
        `Imported ${prepared.added} new and updated ${prepared.updated} existing items.`,
      );
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setImporting(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-8 md:px-8">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted">
          Customize your shelf, move your data, and manage your account.
        </p>
      </header>

      <SettingsSection title="Appearance">
        <fieldset disabled={savingPreference}>
          <legend className="text-sm font-medium text-ink">
            Library theme
          </legend>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {LIBRARY_THEMES.map((theme) => (
              <label
                key={theme}
                className={`cursor-pointer rounded-lg border p-2 transition-colors focus-within:ring-2 focus-within:ring-accent ${
                  settings.libraryTheme === theme
                    ? "border-accent bg-well"
                    : "border-divider bg-panel hover:border-muted"
                }`}
              >
                <input
                  type="radio"
                  name="library-theme"
                  value={theme}
                  checked={settings.libraryTheme === theme}
                  onChange={() => void savePreferences({ libraryTheme: theme })}
                  className="sr-only"
                />
                <span
                  aria-hidden="true"
                  className={`block h-14 rounded ${THEME_COLORS[theme]} ring-1 ring-white/10`}
                />
                <span className="mt-2 block text-sm font-medium text-ink">
                  {THEME_LABELS[theme]}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="mt-6 flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium text-ink">
              Library progress bars
            </span>
            <span className="mt-0.5 block text-xs text-muted">
              Show progress when Shelfie can calculate a meaningful percentage.
            </span>
          </span>
          <input
            type="checkbox"
            checked={settings.showProgressBars}
            disabled={savingPreference}
            onChange={(event) =>
              void savePreferences({
                showProgressBars: event.currentTarget.checked,
              })
            }
            className="size-5 shrink-0 accent-[var(--color-accent)]"
          />
        </label>
        {preferenceError && (
          <p className="mt-3 text-sm text-danger">{preferenceError}</p>
        )}
      </SettingsSection>

      <SettingsSection title="Data">
        <p className="text-sm text-muted">
          Export a Shelfie CSV backup or restore one. Imports overwrite matching
          items only after every row has been validated.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void exportCsv()}
            className={buttonClass}
          >
            <IconDownload className="size-4" /> Export CSV
          </button>
          <label className={`${buttonClass} cursor-pointer`}>
            <IconUpload className="size-4" />
            {importing ? "Importing…" : "Import CSV"}
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              disabled={importing}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void importCsv(file);
              }}
              className="sr-only"
            />
          </label>
        </div>
        {dataMessage && (
          <p className="mt-3 text-sm text-accent">{dataMessage}</p>
        )}
        {dataError && (
          <p className="mt-3 whitespace-pre-wrap text-sm text-danger">
            {dataError}
          </p>
        )}
      </SettingsSection>

      <SettingsSection title="Account">
        <UsernameForm settings={settings} setSettings={setSettings} />
        <div className="my-6 border-t border-divider" />
        <PasswordForm />
      </SettingsSection>
    </div>
  );
}

function UsernameForm({
  settings,
  setSettings,
}: {
  settings: OwnerSettings;
  setSettings: (settings: OwnerSettings) => void;
}) {
  const [username, setUsername] = useState(settings.username);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await changeUsername(password, username);
      const trimmed = username.trim();
      setUsername(trimmed);
      setPassword("");
      setSettings({ ...settings, username: trimmed });
      setMessage("Username changed. Other sessions were signed out.");
    } catch {
      setError("Could not change username. Check your current password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <h3 className="text-sm font-medium text-ink">Change username</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="New username">
          <input
            value={username}
            maxLength={64}
            autoComplete="username"
            onChange={(event) => setUsername(event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Current password">
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
      <SubmitRow
        busy={busy}
        disabled={!username.trim() || !password}
        label="Change username"
        message={message}
        error={error}
      />
    </form>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    if (next !== confirm) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setMessage("Password changed. Other sessions were signed out.");
    } catch {
      setError("Could not change password. Check your current password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <h3 className="text-sm font-medium text-ink">Change password</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Current password">
          <input
            type="password"
            value={current}
            autoComplete="current-password"
            onChange={(e) => setCurrent(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="New password">
          <input
            type="password"
            value={next}
            autoComplete="new-password"
            onChange={(e) => setNext(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Confirm password">
          <input
            type="password"
            value={confirm}
            autoComplete="new-password"
            onChange={(e) => setConfirm(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
      <SubmitRow
        busy={busy}
        disabled={!current || !next || !confirm}
        label="Change password"
        message={message}
        error={error}
      />
    </form>
  );
}

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-divider bg-panel p-5 shadow">
      <h2 className="font-display text-xl font-medium text-ink">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm text-muted">
      {label}
      {children}
    </label>
  );
}

function SubmitRow({
  busy,
  disabled,
  label,
  message,
  error,
}: {
  busy: boolean;
  disabled: boolean;
  label: string;
  message: string | null;
  error: string | null;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button
        type="submit"
        disabled={busy || disabled}
        className="rounded bg-accent px-3 py-2 text-sm font-medium text-accent-ink hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Saving…" : label}
      </button>
      {message && <p className="text-sm text-accent">{message}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

const inputClass =
  "mt-1 w-full rounded bg-bg px-3 py-2 text-ink outline-none ring-1 ring-divider focus:ring-accent";
const buttonClass =
  "inline-flex items-center gap-2 rounded border border-divider bg-well px-3 py-2 text-sm font-medium text-ink hover:border-muted disabled:cursor-not-allowed disabled:opacity-50";
