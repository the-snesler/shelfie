import { useEffect, useState } from "react";

/**
 * Hand-rolled SPA router (history API only, no router dependency). Three
 * routes: `/` (library), `/search`, `/games/:slug` (detail). Everything
 * else is unknown and gets redirected to `/` via `replaceState`.
 */
export type Route =
  { view: "library" } | { view: "search" } | { view: "detail"; slug: string };

/** Matches a pathname against a known route, or `null` if unrecognized. */
function matchPath(pathname: string): Route | null {
  if (pathname === "/") return { view: "library" };
  if (pathname === "/search") return { view: "search" };
  const detail = /^\/games\/([^/]+)$/.exec(pathname);
  if (detail) return { view: "detail", slug: decodeURIComponent(detail[1]) };
  return null;
}

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

// Counts pushState navigations made by this app during the current session.
// Used to tell whether `history.back()` is safe to use (lands on a
// same-origin, in-app state) versus a hard reload straight onto a deep link,
// where the previous history entry may be off-app or nonexistent.
let pushCount = 0;

export function navigate(
  path: string,
  options: { replace?: boolean } = {},
): void {
  if (options.replace) {
    history.replaceState(null, "", path);
  } else {
    history.pushState(null, "", path);
    pushCount++;
  }
  notify();
}

/** Whether this app has pushed at least one history entry this session. */
export function hasAppHistory(): boolean {
  return pushCount > 0;
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    if (pushCount > 0) pushCount--;
    notify();
  });
}

function resolveRoute(): Route {
  const parsed = matchPath(window.location.pathname);
  if (!parsed) {
    navigate("/", { replace: true });
    return { view: "library" };
  }
  return parsed;
}

/** Subscribes to the current route, redirecting unknown paths to `/`. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => resolveRoute());

  useEffect(() => {
    setRoute(resolveRoute());
    const listener = () => setRoute(resolveRoute());
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return route;
}
