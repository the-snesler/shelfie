import type { LibraryItem, MediaType } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { useEffect, useMemo } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router";
import type { AppOutletContext } from "../../App";
import { refreshCardCaches } from "../../db/refreshCards";
import { compareLibraryItems } from "../library/librarySorting";
import { MediaCover } from "../media/MediaCover";
import type { CardMeta } from "../media/useLibraryData";
import { cardCover, cardName, useLibraryData } from "../media/useLibraryData";
import {
  allLists,
  LIST_SECTION_LABELS,
  LIST_SECTIONS,
  listMembers,
  listVisible,
  type AutoList,
} from "./automaticLists";
import { listHref } from "./listHref";
import { emptyTypeCounts } from "./listStats";
import { parseMediaType } from "./listViewState";
import { MediaFilter } from "./MediaFilter";
import { useListContext } from "./useListContext";

const PREVIEW_COVERS = 4;

interface ListSummary {
  list: AutoList;
  count: number;
  preview: RxDocument<LibraryItem>[];
}

export default function Lists() {
  const { db, settings } = useOutletContext<AppOutletContext>();
  const { items, cards } = useLibraryData(db);
  const ctx = useListContext(cards);
  const [searchParams] = useSearchParams();
  const type = parseMediaType(searchParams.get("type"));

  const libraryCounts = useMemo(() => {
    const counts = emptyTypeCounts();
    for (const item of items) counts[item.mediaType] += 1;
    return counts;
  }, [items]);

  const summaries = useMemo(() => {
    const out: ListSummary[] = [];
    for (const list of allLists(items)) {
      const members = listMembers(list, items, type, ctx);
      if (!listVisible(list, type, members.length)) continue;
      out.push({
        list,
        count: members.length,
        preview: members
          .sort((a, b) =>
            compareLibraryItems(
              a,
              b,
              list.defaultSort,
              cards,
              list.defaultDirection,
            ),
          )
          .slice(0, PREVIEW_COVERS),
      });
    }
    return out;
  }, [items, cards, type, ctx]);

  // Home only warms unfinished cards; warm just the covers shown here.
  const previewItems = useMemo(() => {
    const seen = new Map<string, RxDocument<LibraryItem>>();
    for (const { preview } of summaries) {
      for (const item of preview) seen.set(item.id, item);
    }
    return [...seen.values()];
  }, [summaries]);
  const previewKey = previewItems
    .map((item) => item.id)
    .sort()
    .join(",");
  useEffect(() => {
    void refreshCardCaches(db, previewItems);
    // previewKey is the stable dependency; previewItems only matter via ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, previewKey]);

  return (
    <div
      className="library-wall min-h-full"
      data-library-theme={settings.libraryTheme}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-8 md:px-8">
        <header className="flex flex-col gap-4">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
            Lists
          </h1>
          <MediaFilter type={type} counts={libraryCounts} />
        </header>
        {LIST_SECTIONS.map((section) => {
          const lists = summaries.filter((s) => s.list.section === section);
          if (lists.length === 0) return null;
          return (
            <section key={section} className="flex flex-col gap-3">
              <h2 className="font-display text-xl font-medium text-ink">
                {LIST_SECTION_LABELS[section]}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {lists.map((summary) => (
                  <ListTile
                    key={summary.list.id}
                    summary={summary}
                    type={type}
                    cards={cards}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ListTile({
  summary: { list, count, preview },
  type,
  cards,
}: {
  summary: ListSummary;
  type: MediaType | null;
  cards: Map<string, CardMeta>;
}) {
  const Icon = list.icon;
  return (
    <Link
      to={listHref(list.id, type)}
      className={`flex items-center gap-4 rounded-lg border border-divider bg-panel/80 p-3 hover:border-accent ${
        count === 0 ? "opacity-55" : ""
      }`}
    >
      <div className="flex h-[72px] w-[96px] shrink-0 items-center">
        {preview.length > 0 ? (
          <div className="flex -space-x-7">
            {preview.map((item) => (
              <div key={item.id} className="pointer-events-none">
                <MediaCover
                  coverUrl={cardCover(item.mediaType, cards.get(item.id))}
                  coverHash={cards.get(item.id)?.coverHash}
                  name={cardName(item, cards.get(item.id))}
                  width={46}
                  mediaType={item.mediaType}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex size-full items-center justify-center rounded border border-dashed border-divider text-faint">
            <Icon className="size-6" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 font-medium text-ink">
          <Icon className="size-4 shrink-0 text-accent" />
          <span className="truncate">{list.label(type)}</span>
        </p>
        <p className="text-sm text-faint tabular-nums">
          {count} {count === 1 ? "title" : "titles"}
        </p>
        <p className="line-clamp-2 text-xs text-muted">
          {list.description(type)}
        </p>
      </div>
    </Link>
  );
}
