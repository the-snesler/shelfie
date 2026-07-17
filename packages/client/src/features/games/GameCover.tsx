import type { ReactNode } from "react";
import { DEFAULT_TEMPLATE, platformTemplates } from "./platforms";

export function GameCover({
  coverUrl,
  platform,
  name,
  scale,
  children,
}: {
  coverUrl: string | null;
  platform: string | null;
  name: string;
  scale: number; // px per mm of case height
  children?: ReactNode;
}) {
  const template = platform ? platformTemplates[platform] : undefined;
  const aspectRatio = template?.aspectRatio ?? DEFAULT_TEMPLATE.aspectRatio;
  const heightMm = template?.heightMm ?? DEFAULT_TEMPLATE.heightMm;

  const style = {
    "height": `${heightMm * scale}px`,
    "width": `${heightMm * scale * aspectRatio}px`,
    "aspectRatio": String(aspectRatio),
    "--case-color": template?.caseColor ?? "transparent",
    "--art-padding-top": template?.paddingTop
      ? `${template.paddingTop}px`
      : "0px",
  } as React.CSSProperties;

  return (
    <div
      className="video-game relative overflow-hidden rounded bg-panel"
      style={style}
    >
      {coverUrl ? (
        <img
          src={coverUrl}
          alt={name}
          className="h-full w-full object-cover pt-(--art-padding-top)"
          loading="lazy"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-muted">
          {name}
        </div>
      )}
      {template && (
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
