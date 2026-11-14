import { useState } from "react";
import { Link } from "react-router";
import IconSearch from "~icons/tabler/search";
import IconSparkles from "~icons/tabler/sparkles";
import type { ShelfieDatabase } from "../../db/database";

/** Empty Home for a guest: offers the demo shelf instead of a dead end. The
 *  demo module (and its bundled card fixture) loads only when asked for. */
export function GuestEmptyShelf({ db }: { db: ShelfieDatabase }) {
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");

  async function loadDemo() {
    setState("loading");
    try {
      const { loadDemoShelf } = await import("./demoShelf");
      await loadDemoShelf(db);
    } catch (error) {
      console.warn("Could not load the demo shelf", error);
      setState("failed");
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 pb-16 text-center text-muted">
      <p className="font-display text-2xl text-ink">Your shelf is empty</p>
      <p className="max-w-md text-sm">
        Fill it with a demo collection of games, movies, shows, and books to see
        how Shelfie works, or search to start your own. Everything stays in this
        browser.
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={() => void loadDemo()}
          disabled={state === "loading"}
          className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:brightness-110 disabled:opacity-60"
        >
          <IconSparkles className="size-4" />
          {state === "loading" ? "Filling shelf…" : "Load demo shelf"}
        </button>
        <Link
          to="/search"
          className="flex items-center gap-2 rounded-md border border-divider bg-panel px-4 py-2 text-sm font-medium text-ink hover:border-accent"
        >
          <IconSearch className="size-4" />
          Browse the catalog
        </Link>
      </div>
      {state === "failed" && (
        <p className="text-sm text-danger">
          Could not load the demo shelf. Try again.
        </p>
      )}
    </div>
  );
}

/** Reminds a guest where their shelf lives and lets them start over. */
export function GuestShelfNotice({ db }: { db: ShelfieDatabase }) {
  const [clearing, setClearing] = useState(false);

  async function clear() {
    if (
      !window.confirm(
        "Clear this guest shelf? Every title and log in this browser will be removed.",
      )
    )
      return;
    setClearing(true);
    try {
      await db.library_items.find().remove();
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="ml-auto flex items-center gap-3 text-xs text-faint">
      <span>Guest shelf, saved in this browser</span>
      <button
        type="button"
        onClick={() => void clear()}
        disabled={clearing}
        className="rounded-md border border-divider px-2 py-1 text-muted hover:border-danger hover:text-danger disabled:opacity-60"
      >
        Clear shelf
      </button>
    </div>
  );
}
