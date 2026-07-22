import type { GameDetail, StoreName } from "@shelfie/shared";
import { useState } from "react";
import { useLocation, useNavigate, useOutletContext } from "react-router";
import type { AppOutletContext } from "../../App";
import type { Route } from "./+types/Detail";
import { upsertCards } from "../../db/gameCards";
import { GameCover } from "../games/GameCover";
import {
  DETAIL_COVER_SCALE,
  gameCoverTransitionName,
  selectPlatform,
} from "../games/platforms";
import { gameImageUrl } from "../../images";
import { Lightbox } from "./Lightbox";
import { releaseDateFromEpoch } from "../media/libraryActions";
import { StatusControl } from "../media/StatusControl";
import { useBackNavigation } from "./useBackNavigation";
import { useDetailFetch } from "./useDetailFetch";
import {
  Description,
  DetailBodySkeleton,
  DetailCard,
  DetailHero,
  DetailPage,
  DetailRow,
  DetailSection,
  NotFound,
  RatingPills,
  TrailerChips,
} from "./DetailChrome";

const STORE_LABELS: Record<StoreName, string> = {
  official: "Official site",
  steam: "Steam",
  epic: "Epic",
  gog: "GOG",
  itch: "itch.io",
};

/** Minimal cover data passed via `<Link state>` from the library/search
 *  cards that navigate here, so the first paint (before the detail fetch
 *  resolves) already has a cover box on-screen — a view transition can only
 *  pair a `view-transition-name` across old/new snapshots if the named
 *  element is actually present in the DOM when each snapshot is taken. */
interface DetailLinkState {
  coverUrl: string | null;
  platform: string | null;
  name: string;
}

/** Whole hours + minutes, e.g. `64800 -> "18h"`, `81000 -> "22h 30m"`. */
function formatHltb(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

export default function Detail({ params }: Route.ComponentProps) {
  const { db } = useOutletContext<AppOutletContext>();
  const slug = params.slug;
  const navigate = useNavigate();
  const location = useLocation();
  const { metaState, item } = useDetailFetch<GameDetail>({
    db,
    url: `/api/games/by-slug/${encodeURIComponent(slug)}`,
    libraryItemId: (meta) => `game:${meta.igdbId}`,
    upsertCards,
  });
  const [lightbox, setLightbox] = useState<number | null>(null);
  const handleBack = useBackNavigation();

  if (metaState.status === "loading") {
    const linkState = location.state as DetailLinkState | null;
    return (
      <DetailPage onBack={handleBack}>
        <DetailHero
          name={linkState?.name ?? null}
          cover={
            <GameCover
              coverUrl={linkState?.coverUrl ?? null}
              platform={linkState?.platform ?? null}
              name={linkState?.name ?? "Loading…"}
              scale={DETAIL_COVER_SCALE}
              viewTransitionName={gameCoverTransitionName(slug)}
            />
          }
        />
        <DetailBodySkeleton />
      </DetailPage>
    );
  }

  if (metaState.status === "error") {
    return <NotFound message="Game not found" onBack={() => navigate("/")} />;
  }

  const meta = metaState.meta;
  const cover = meta.coverImageId
    ? gameImageUrl("t_cover_big", meta.coverImageId)
    : null;
  const detailPlatform = selectPlatform(
    item?.platforms ?? [],
    meta.platforms,
    meta.platformReleaseDates,
  );
  const detailRows = [
    meta.developer && { label: "Developer", value: meta.developer },
    meta.publisher && { label: "Publisher", value: meta.publisher },
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
    meta.platforms.length > 0 && {
      label: "Platforms",
      value: meta.platforms.join(" · "),
    },
  ].filter((row): row is { label: string; value: string } => Boolean(row));

  return (
    <DetailPage onBack={handleBack}>
      <DetailHero
        name={meta.name}
        lines={[
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
        ]}
        cover={
          <GameCover
            coverUrl={cover}
            platform={detailPlatform}
            name={meta.name}
            scale={DETAIL_COVER_SCALE}
            viewTransitionName={gameCoverTransitionName(slug)}
          />
        }
      >
        <div className="mt-2 flex flex-col items-start gap-3">
          <RatingPills
            pills={[
              meta.aggregatedRating != null &&
                `Critics ${Math.round(meta.aggregatedRating)}${
                  meta.aggregatedRatingCount > 0
                    ? ` (${meta.aggregatedRatingCount})`
                    : ""
                }`,
              meta.rating != null && `IGDB ${(meta.rating / 10).toFixed(1)}`,
              meta.timeToBeat?.normally != null &&
                `HLTB ~${formatHltb(meta.timeToBeat.normally)}`,
            ]}
          />
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
        </div>
      </DetailHero>
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
    </DetailPage>
  );
}
