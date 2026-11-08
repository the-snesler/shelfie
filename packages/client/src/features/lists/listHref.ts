import type { MediaType } from "@shelfie/shared";

/** `/lists/:id`, carrying the media filter along when one is set. */
export function listHref(id: string, type: MediaType | null): string {
  const path = `/lists/${encodeURIComponent(id)}`;
  return type ? `${path}?type=${type}` : path;
}
