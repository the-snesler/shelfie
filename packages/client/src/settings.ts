import type { OwnerPreferences, OwnerSettings } from "@shelfie/shared";
import { authFetch } from "./auth";

export async function getSettings(): Promise<OwnerSettings> {
  const res = await authFetch("/api/settings");
  if (!res.ok) throw new Error(`settings failed: ${res.status}`);
  return res.json() as Promise<OwnerSettings>;
}

export async function updatePreferences(
  preferences: Partial<OwnerPreferences>,
): Promise<OwnerSettings> {
  const res = await authFetch("/api/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(preferences),
  });
  if (!res.ok) throw new Error(`settings update failed: ${res.status}`);
  return res.json() as Promise<OwnerSettings>;
}
