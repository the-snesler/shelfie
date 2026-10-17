export function normalizeAppriseEndpoint(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  if (!value.trim()) return "";
  try {
    const url = new URL(value.trim());
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    return url.href.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function normalizeDestinations(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 16000) return null;
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (
    lines.length > 20 ||
    lines.some(
      (line) =>
        line.length > 2048 || !/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(line),
    )
  )
    return null;
  return [...new Set(lines)].join("\n");
}

/** Stateless Apprise API: POST /notify/ with urls/title/body/format. */
export async function sendApprise(
  endpoint: string,
  destinations: string,
  title: string,
  body: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  try {
    const response = await fetcher(`${endpoint}/notify/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        urls: destinations.split("\n"),
        title,
        body,
        format: "text",
        type: "info",
      }),
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    // Never log or return Apprise's response body: it can contain destination credentials.
    await response.body?.cancel();
    if (!response.ok)
      throw new Error(`Apprise returned HTTP ${response.status}`);
  } catch (error) {
    if (
      error instanceof Error &&
      /^Apprise returned HTTP \d+$/.test(error.message)
    )
      throw error;
    throw new Error("Could not reach Apprise within 8 seconds", {
      cause: error,
    });
  }
}
