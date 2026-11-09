import { authFetch } from "../../auth";

/** JSON request to an import endpoint; throws the server's error message. */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(path, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const inputClass =
  "mt-1 w-full rounded bg-bg px-3 py-2 text-ink outline-none ring-1 ring-divider focus:ring-accent";
export const buttonClass =
  "inline-flex items-center rounded border border-divider bg-well px-3 py-2 text-sm font-medium text-ink hover:border-muted disabled:cursor-not-allowed disabled:opacity-50";
