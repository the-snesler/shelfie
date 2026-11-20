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
import { formatIsoDay } from "../media/dates";
import { ExpandableText } from "./DetailChrome";
import { Rail, VideoRail } from "./Rail";

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
        const coverUrl = meta.coverImageId
          ? gameImageUrl("t_cover_big", meta.coverImageId)
          : null;
        const ttb = meta.timeToBeat;
        return {
          name: meta.name,
          coverUrl,
          backdrop: meta.screenshotImageIds[0]
            ? gameImageUrl("t_1080p", meta.screenshotImageIds[0])
            : null,
          lines: [
            [
              meta.firstReleaseDate &&
                new Date(meta.firstReleaseDate * 1000).getFullYear(),
              meta.genres.length > 0 && meta.genres.join(", "),
            ]
              .filter(Boolean)
              .join(" · "),
            [meta.developer, meta.publisher]
              .filter(Boolean)
              .filter((v, i, arr) => arr.indexOf(v) === i)
              .join(" · "),
          ],
          pills: [
            meta.aggregatedRating != null &&
              `Critics ${Math.round(meta.aggregatedRating)}${
                meta.aggregatedRatingCount > 0
                  ? ` · ${meta.aggregatedRatingCount}`
                  : ""
              }`,
            meta.rating != null &&
              `IGDB ${(meta.rating / 10).toFixed(1)}${
                meta.ratingCount > 0 ? ` · ${meta.ratingCount}` : ""
              }`,
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
          about: (meta.summary || meta.storyline) && (
            <ExpandableText>
              {meta.summary && <p>{meta.summary}</p>}
              {meta.storyline && <p className="text-muted">{meta.storyline}</p>}
            </ExpandableText>
          ),
          facts: [
            {
              label: "Released",
              value: formatIsoDay(releaseDateFromEpoch(meta.firstReleaseDate)),
            },
            { label: "Developer", value: meta.developer },
            meta.publisher !== meta.developer && {
              label: "Publisher",
              value: meta.publisher,
            },
            { label: "Platforms", value: meta.platforms.join(", ") },
            { label: "Modes", value: meta.gameModes.join(", ") },
            { label: "Perspective", value: meta.playerPerspectives.join(", ") },
            { label: "Themes", value: meta.themes.join(", ") },
            ttb?.hastily != null && {
              label: "Rushed",
              value: `~${formatDuration(ttb.hastily)}`,
            },
            ttb?.normally != null && {
              label: "Main story",
              value: `~${formatDuration(ttb.normally)}`,
            },
            ttb?.completely != null && {
              label: "Completionist",
              value: `~${formatDuration(ttb.completely)}`,
            },
          ],
          links: [
            ...meta.stores.map((store) => ({
              label: STORE_LABELS[store.store],
              href: store.url,
            })),
            {
              label: "IGDB",
              href: `https://www.igdb.com/games/${encodeURIComponent(meta.slug)}`,
            },
          ],
          body: (
            <>
              {meta.screenshotImageIds.length > 0 && (
                <Rail
                  title="Screenshots"
                  count={meta.screenshotImageIds.length}
                >
                  {meta.screenshotImageIds.map((id, i) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setLightbox(i)}
                      className="aspect-video w-64 shrink-0 snap-start overflow-hidden rounded-md bg-well ring-1 ring-divider hover:ring-accent"
                    >
                      <img
                        loading="lazy"
                        src={gameImageUrl("t_screenshot_med", id)}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ))}
                </Rail>
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
              <VideoRail videos={meta.videos} />
            </>
          ),
        };
      }}
    />
  );
}
