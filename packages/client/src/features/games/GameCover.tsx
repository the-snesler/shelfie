import { useState, type ReactNode } from "react";
import type { CoverSize } from "@shelfie/shared";
import { gameCoverUrl } from "../../images";
import {
  DEFAULT_TEMPLATE,
  platformCoverShape,
  platformTemplates,
} from "./platforms";

export function GameCover({
  coverUrl,
  igdbId,
  coverSize = "thumb",
  platform,
  name,
  scale,
  viewTransitionName,
  children,
}: {
  /** IGDB cover (`/api/images/t_cover_big/...`); the fallback art. */
  coverUrl: string | null;
  /** Enables platform-fitted SteamGridDB art; omit to always use `coverUrl`. */
  igdbId?: number | null;
  /** `thumb` (400px) for grid/search sizes, `full` for the detail hero. */
  coverSize?: CoverSize;
  platform: string | null;
  name: string;
  scale: number; // px per mm of case height
  /** CSS `view-transition-name` to assign to the cover box, e.g. from
   *  `gameCoverTransitionName()`; omit (or leave undefined) outside an
   *  active transition so idle covers never claim a transition name. */
  viewTransitionName?: string;
  children?: ReactNode;
}) {
  const template = platform ? platformTemplates[platform] : undefined;
  const fittedUrl = gameCoverUrl(
    coverUrl,
    igdbId,
    platformCoverShape(platform),
    coverSize,
  );
  // A fitted cover that fails outright (no IGDB fallback to redirect to, or a
  // network error) drops back to the plain IGDB art / title placeholder.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const imageUrl = fittedUrl !== failedUrl ? fittedUrl : coverUrl;
  const aspectRatio = template?.aspectRatio ?? DEFAULT_TEMPLATE.aspectRatio;
  const heightMm = template?.heightMm ?? DEFAULT_TEMPLATE.heightMm;

  const style = {
    height: `${heightMm * scale}px`,
    width: `${heightMm * scale * aspectRatio}px`,
    aspectRatio: String(aspectRatio),
    "--case-color": template?.caseColor ?? "#131314",
    "--art-padding-top": template?.paddingTop
      ? `${template.paddingTop}px`
      : "0px",
    "--scale": scale,
    viewTransitionName: viewTransitionName ?? "none",
  } as React.CSSProperties;

  return (
    <div
      className="video-game relative overflow-hidden rounded bg-panel"
      style={style}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={name}
          style={{ "--scale": scale } as React.CSSProperties}
          className="h-full w-full object-cover pt-[calc(var(--scale)*var(--art-padding-top))]"
          loading="lazy"
          onError={() => {
            if (imageUrl === fittedUrl) setFailedUrl(fittedUrl);
          }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-muted">
          {name}
        </div>
      )}
      {template?.overlay && (
        <img
          src={template.overlay}
          alt=""
          aria-hidden
          className="pointer-events-none absolute top-(--box-art-padding) left-0 bottom-(--box-art-padding) right-(--box-art-padding) object-fill pr-(--box-art-padding)"
        />
      )}
      {children}
    </div>
  );
}
