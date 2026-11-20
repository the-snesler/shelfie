import type { GameDetail as GameDetailDto, StoreName } from "@shelfie/shared";
import { useState } from "react";
import { useOutletContext } from "react-router";
import type { AppOutletContext } from "../../App";
import type { Route } from "./+types/GameDetail";
import { upsertCards } from "../../db/gameCards";
import { GameCover } from "../games/GameCover";
import {
  DETAIL_COVER_SCALE,
  gameCoverTransitionName,
  selectPlatform,
} from "../games/platforms";
import { gameImageUrl } from "../../images";
import { Lightbox } from "./Lightbox";
import { formatDuration } from "../media/duration";
import { releaseDateFromEpoch } from "../media/libraryActions";
import { StatusControl } from "../media/StatusControl";
import { useDetailFetch } from "./useDetailFetch";
import { DetailScreen } from "./DetailScreen";
import {
  Description,
  DetailCard,
  DetailRow,
  DetailSection,
  TrailerChips,
} from "./DetailChrome";

const STORE_LABELS: Record<StoreName, string> = {
  official: "Official site",
  steam: "Steam",
  epic: "Epic",
  gog: "GOG",
  itch: "itch.io",
};

export default function GameDetail({ params }: Route.ComponentProps) {
  const { db } = useOutletContext<AppOutletContext>();
  const slug = params.slug;
  const { metaState, item } = useDetailFetch<GameDetailDto>({
    db,
    url: `/api/games/by-slug/${encodeURIComponent(slug)}`,
    libraryItemId: (meta) => `game:${meta.igdbId}`,
    upsertCards,
  });
  const [lightbox, setLightbox] = useState<number | null>(null);

  return (
    <DetailScreen
      state={metaState}
      item={item}
      notFoundMessage="Game not found"
      cover={(meta, link) => (
        <GameCover
          coverUrl={
            meta
              ? meta.coverImageId
                ? gameImageUrl("t_cover_big", meta.coverImageId)
                : null
              : (link?.coverUrl ?? null)
          }
          coverHash={meta ? meta.coverHash : link?.coverHash}
          platform={
            meta
              ? selectPlatform(
                  item?.platforms ?? [],
                  meta.platforms,
                  meta.platformReleaseDates,
                )
              : (link?.platform ?? null)
          }
          name={meta?.name ?? link?.name ?? "Loading…"}
          scale={DETAIL_COVER_SCALE}
          viewTransitionName={gameCoverTransitionName(slug)}
        />
      )}
      render={(meta) => {
        const detailRows = [
          meta.gameModes.length > 0 && {
            label: "Modes",
            value: meta.gameModes.join(" · "),
          },
          meta.themes.length > 0 && {
            label: "Themes",
            value: meta.themes.join(" · "),
          },
          meta.playerPerspectives.length > 0 && {
            label: "Perspectives",
            value: meta.playerPerspectives.join(" · "),
          },
        ].filter((row): row is { label: string; value: string } =>
          Boolean(row),
        );

        return {
          name: meta.name,
          lines: [
            [
              meta.firstReleaseDate &&
                new Date(meta.firstReleaseDate * 1000).getFullYear(),
              meta.genres.length > 0 && meta.genres.join(", "),
            ]
              .filter(Boolean)
              .join(" · "),
            meta.platforms.length > 0 && meta.platforms.join(", "),
            [meta.developer, meta.publisher]
              .filter(Boolean)
              .filter((v, i, arr) => arr.indexOf(v) === i)
              .join(" · "),
          ],
          pills: [
            meta.aggregatedRating != null &&
              `Critics ${Math.round(meta.aggregatedRating)}${
                meta.aggregatedRatingCount > 0
                  ? ` (${meta.aggregatedRatingCount})`
                  : ""
              }`,
            meta.rating != null && `IGDB ${(meta.rating / 10).toFixed(1)}`,
            meta.timeToBeat?.normally != null &&
              `HLTB ~${formatDuration(meta.timeToBeat.normally)}`,
          ],
          status: (
            <StatusControl
              db={db}
              target={{
                mediaType: "game",
                sourceId: String(meta.igdbId),
                name: meta.name,
                platforms: meta.platforms,
                releaseDate: releaseDateFromEpoch(meta.firstReleaseDate),
              }}
              item={item}
            />
          ),
          body: (
            <>
              {(meta.summary || meta.storyline) && (
                <div className="flex flex-col gap-2">
                  {meta.summary && <Description>{meta.summary}</Description>}
                  {meta.storyline && (
                    <p className="max-w-[70ch] text-sm leading-relaxed text-muted">
                      {meta.storyline}
                    </p>
                  )}
                </div>
              )}
              {meta.screenshotImageIds.length > 0 && (
                <DetailSection title="Screenshots">
                  <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
                    {meta.screenshotImageIds.map((id, i) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setLightbox(i)}
                        className="shrink-0"
                      >
                        <img
                          loading="lazy"
                          src={gameImageUrl("t_screenshot_med", id)}
                          className="h-28 w-auto rounded-lg object-contain ring-1 ring-divider"
                        />
                      </button>
                    ))}
                  </div>
                </DetailSection>
              )}
              {lightbox !== null && (
                <Lightbox
                  images={meta.screenshotImageIds.map((id) =>
                    gameImageUrl("t_1080p", id),
                  )}
                  index={lightbox}
                  onClose={() => setLightbox(null)}
                  onIndexChange={setLightbox}
                />
              )}
              <TrailerChips videos={meta.videos} />
              {(detailRows.length > 0 || meta.stores.length > 0) && (
                <DetailSection title="Details">
                  <DetailCard>
                    {detailRows.map((row) => (
                      <DetailRow key={row.label} label={row.label}>
                        {row.value}
                      </DetailRow>
                    ))}
                    {meta.stores.length > 0 && (
                      <DetailRow label="Get it">
                        <span className="flex flex-wrap justify-end gap-2">
                          {meta.stores.map((store) => (
                            <a
                              key={store.store}
                              target="_blank"
                              rel="noreferrer"
                              href={store.url}
                              className="font-medium text-accent hover:underline"
                            >
                              {STORE_LABELS[store.store]}
                            </a>
                          ))}
                        </span>
                      </DetailRow>
                    )}
                  </DetailCard>
                </DetailSection>
              )}
            </>
          ),
        };
      }}
    />
  );
}
