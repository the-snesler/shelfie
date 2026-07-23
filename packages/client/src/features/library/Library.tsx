import type { LibraryItem, MediaType, MetaStatus } from "@shelfie/shared";
import { MEDIA_TYPES, META_STATUSES, STATUS_META_GROUP } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { useMemo, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router";
import type { AppOutletContext } from "../../App";
import {
  getLibraryTheme,
  setLibraryTheme,
  type LibraryTheme,
} from "../../libraryTheme";
import { META_STATUS_LABELS } from "../media/status";
import { cardCaption } from "./libraryCaptions";
import { LibraryItemCard } from "./LibraryItemCard";
import { LibraryThemePicker } from "./LibraryThemePicker";
import { useLibraryData } from "./useLibraryData";

const MEDIA_LABELS: Record<MediaType, string> = {
  movie: "Movies",
  tv: "TV Shows",
  book: "Books",
  game: "Games",
};

export default function Library() {
  const { db } = useOutletContext<AppOutletContext>();
  const { items, cards, tvCatalogs } = useLibraryData(db);
  const [theme, setTheme] = useState<LibraryTheme>(getLibraryTheme);

  const [searchParams] = useSearchParams();
  const typeParam = searchParams.get("type");
  const activeType = (MEDIA_TYPES as readonly string[]).includes(
    typeParam ?? "",
  )
    ? (typeParam as MediaType)
    : null;

  const filtered = useMemo(
    () =>
      activeType
        ? items.filter((item) => item.mediaType === activeType)
        : items,
    [items, activeType],
  );

  const grouped = useMemo(() => {
    const map = new Map<MetaStatus, RxDocument<LibraryItem>[]>();
    for (const item of filtered) {
      const g = STATUS_META_GROUP[item.status];
      const arr = map.get(g);
      if (arr) arr.push(item);
      else map.set(g, [item]);
    }
    return map;
  }, [filtered]);

  const heading = activeType ? MEDIA_LABELS[activeType] : "Library";

  function handleThemeChange(nextTheme: LibraryTheme) {
    setTheme(nextTheme);
    setLibraryTheme(nextTheme);
  }

  return (
    <div
      className="library-wall min-h-full"
      data-library-theme={theme}
    >
      <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-10 px-5 py-8 md:px-8">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex min-w-0 items-baseline gap-3">
            <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
              {heading}
            </h1>
            <span className="text-sm text-faint">
              {filtered.length} on the shelf
            </span>
          </div>
          <LibraryThemePicker
            value={theme}
            onChange={handleThemeChange}
          />
        </header>
        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 pb-16 text-center text-muted">
            <p className="font-display text-2xl text-ink">
              Your shelf is empty
            </p>
            <p className="text-sm">
              Search for a game, movie, show, or book to add your first one.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-muted">
            <p className="font-display text-xl text-ink">
              No {heading.toLowerCase()} on your shelf yet
            </p>
            <p className="text-sm">Find some with the search bar.</p>
          </div>
        ) : (
          META_STATUSES.filter((g) => grouped.get(g)?.length).map((g) => (
            <section key={g} className="flex flex-col">
              <h2 className="font-display text-xl font-medium text-ink">
                {META_STATUS_LABELS[g]}
                <span className="ml-2 text-sm font-normal text-faint">
                  {grouped.get(g)!.length}
                </span>
              </h2>
              <div className="shelf-rows -mt-2 flex flex-wrap items-start gap-x-6">
                {grouped.get(g)!.map((item) => (
                  <LibraryItemCard
                    key={item.id}
                    db={db}
                    item={item}
                    meta={cards.get(item.id)}
                    caption={cardCaption(item, cards.get(item.id))}
                    catalog={
                      item.mediaType === "tv"
                        ? tvCatalogs.get(item.id)
                        : undefined
                    }
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
