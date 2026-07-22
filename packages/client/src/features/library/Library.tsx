import type { LibraryItem, MediaType, MetaStatus } from "@shelfie/shared";
import { MEDIA_TYPES, META_STATUSES, STATUS_META_GROUP } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { useMemo } from "react";
import { useOutletContext, useSearchParams } from "react-router";
import type { AppOutletContext } from "../../App";
import { META_STATUS_LABELS } from "../media/status";
import { cardCaption } from "./libraryCaptions";
import { LibraryItemCard } from "./LibraryItemCard";
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

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted">
        <p className="font-display text-2xl text-ink">Your shelf is empty</p>
        <p className="text-sm">
          Search for a game, movie, show, or book to add your first one.
        </p>
      </div>
    );
  }

  const heading = activeType ? MEDIA_LABELS[activeType] : "Library";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-5 py-8 md:px-8">
      <header className="flex items-baseline gap-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
          {heading}
        </h1>
        <span className="text-sm text-faint">
          {filtered.length} on the shelf
        </span>
      </header>
      {filtered.length === 0 ? (
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
  );
}
