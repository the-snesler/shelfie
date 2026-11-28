import type {
  ItemStatus,
  PersonCredit,
  PersonDetail as PersonDetailDto,
} from "@tsundo/shared";
import { useEffect, useState } from "react";
import {
  Link,
  useNavigate,
  useOutletContext,
  useViewTransitionState,
} from "react-router";
import IconCheck from "~icons/tabler/check";
import type { AppOutletContext } from "../../App";
import { tmdbImageUrl } from "../../images";
import { formatIsoDay } from "../media/dates";
import { MediaCover, mediaCoverTransitionName } from "../media/MediaCover";
import { STATUS_LABELS } from "../media/status";
import { useToday } from "../media/useToday";
import type { Route } from "./+types/PersonDetail";
import {
  DetailBackdrop,
  DetailBodySkeleton,
  DetailFacts,
  DetailHero,
  DetailPage,
  ExpandableText,
  NotFound,
} from "./DetailChrome";
import { Rail } from "./Rail";
import { useBackNavigation } from "./useBackNavigation";
import { useDetailFetch } from "./useDetailFetch";

const PHOTO_WIDTH = 180;
const KNOWN_FOR_COUNT = 12;

type CreditFilter = "all" | "movie" | "tv";

/** Whole years between two ISO days. */
function yearsBetween(from: string, to: string): number {
  const years = Number(to.slice(0, 4)) - Number(from.slice(0, 4));
  return to.slice(5) < from.slice(5) ? years - 1 : years;
}

function creditKey(credit: PersonCredit): string {
  return `${credit.mediaType}:${credit.tmdbId}`;
}

function creditHref(credit: PersonCredit): string {
  return `/${credit.mediaType === "movie" ? "movies" : "tv"}/${credit.tmdbId}`;
}

/** Library status per `${mediaType}:${tmdbId}` for the given credits, from
 *  whichever database (owner or guest) the app is using. */
function useShelfStatuses(
  db: AppOutletContext["db"],
  credits: readonly PersonCredit[] | null,
): Map<string, ItemStatus> {
  const [statuses, setStatuses] = useState(() => new Map<string, ItemStatus>());
  const ids = credits?.map(creditKey).join(",") ?? "";
  useEffect(() => {
    if (!ids) return;
    const sub = db.library_items
      .find({ selector: { id: { $in: ids.split(",") } } })
      .$.subscribe((docs) => {
        setStatuses(new Map(docs.map((doc) => [doc.id, doc.status])));
      });
    return () => sub.unsubscribe();
  }, [db, ids]);
  return statuses;
}

/**
 * A TMDB person (reached from the cast rails): photo, bio and facts, the
 * titles they're best known for, and their full acting filmography with
 * what's already on your shelf marked.
 */
export default function PersonDetail({ params }: Route.ComponentProps) {
  const { db } = useOutletContext<AppOutletContext>();
  const navigate = useNavigate();
  const handleBack = useBackNavigation();
  const today = useToday();
  const { metaState } = useDetailFetch<PersonDetailDto>({
    db,
    url: `/api/people/by-id/${encodeURIComponent(params.id)}`,
  });
  const [filter, setFilter] = useState<CreditFilter>("all");
  const person = metaState.status === "loaded" ? metaState.meta : null;
  const shelf = useShelfStatuses(db, person?.credits ?? null);

  if (metaState.status === "error") {
    return (
      <NotFound
        message={metaState.message ?? "Person not found"}
        onBack={() => navigate("/")}
      />
    );
  }

  if (!person) {
    return (
      <DetailPage onBack={handleBack}>
        <DetailHero
          backdrop={<DetailBackdrop src={null} />}
          name={null}
          cover={<MediaCover coverUrl={null} name="" width={PHOTO_WIDTH} />}
        />
        <DetailBodySkeleton />
      </DetailPage>
    );
  }

  const photo = person.profilePath
    ? tmdbImageUrl(person.profilePath, "w500")
    : null;
  const age = person.birthday
    ? yearsBetween(person.birthday, person.deathday ?? today)
    : null;
  const movies = person.credits.filter((c) => c.mediaType === "movie");
  const shows = person.credits.filter((c) => c.mediaType === "tv");
  const knownFor = [...person.credits]
    .sort((a, b) => b.voteCount - a.voteCount)
    .slice(0, KNOWN_FOR_COUNT);
  const listed =
    filter === "all"
      ? person.credits
      : person.credits.filter((c) => c.mediaType === filter);
  const onShelf = person.credits.filter((c) => shelf.has(creditKey(c))).length;

  return (
    <DetailPage onBack={handleBack}>
      <DetailHero
        backdrop={<DetailBackdrop src={null} blurSrc={photo} />}
        name={person.name}
        lines={[
          person.knownForDepartment,
          [
            person.credits.length > 0 && `${person.credits.length} credits`,
            onShelf > 0 && `${onShelf} on your shelf`,
          ]
            .filter(Boolean)
            .join(" · "),
        ]}
        cover={
          <MediaCover coverUrl={photo} name={person.name} width={PHOTO_WIDTH} />
        }
        about={
          person.biography && (
            <ExpandableText>
              {person.biography.split(/\n+/).map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
              ))}
            </ExpandableText>
          )
        }
        sidebar={
          <DetailFacts
            facts={[
              { label: "Known for", value: person.knownForDepartment },
              {
                label: "Born",
                value:
                  person.birthday &&
                  `${formatIsoDay(person.birthday)}${
                    age !== null && !person.deathday ? ` (age ${age})` : ""
                  }`,
              },
              {
                label: "Died",
                value:
                  person.deathday &&
                  `${formatIsoDay(person.deathday)}${
                    age !== null ? ` (age ${age})` : ""
                  }`,
              },
              { label: "Birthplace", value: person.placeOfBirth },
              movies.length > 0 && {
                label: "Movies",
                value: String(movies.length),
              },
              shows.length > 0 && {
                label: "Shows",
                value: String(shows.length),
              },
            ]}
            links={[
              person.imdbId && {
                label: "IMDb",
                href: `https://www.imdb.com/name/${person.imdbId}/`,
              },
              {
                label: "TMDB",
                href: `https://www.themoviedb.org/person/${person.tmdbId}`,
              },
            ]}
          />
        }
      />

      {knownFor.length > 0 && (
        <Rail title="Known for">
          {knownFor.map((credit) => (
            <PosterCard
              key={creditKey(credit)}
              credit={credit}
              status={shelf.get(creditKey(credit))}
            />
          ))}
        </Rail>
      )}

      {person.credits.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="font-display text-lg font-medium text-ink">
              Credits
            </h3>
            {movies.length > 0 && shows.length > 0 && (
              <div className="flex gap-1.5" role="tablist" aria-label="Type">
                {(
                  [
                    ["all", `All ${person.credits.length}`],
                    ["movie", `Movies ${movies.length}`],
                    ["tv", `TV ${shows.length}`],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={filter === value}
                    onClick={() => setFilter(value)}
                    className={`rounded-full px-3 py-1 text-xs ring-1 ${
                      filter === value
                        ? "bg-ink font-semibold text-bg ring-ink"
                        : "bg-well text-muted ring-divider hover:text-ink"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <ul className="flex flex-col divide-y divide-divider/60 rounded-xl border border-divider bg-panel/60">
            {listed.map((credit) => {
              const status = shelf.get(creditKey(credit));
              return (
                <li key={creditKey(credit)}>
                  <Link
                    to={creditHref(credit)}
                    viewTransition
                    state={{
                      coverUrl: credit.posterPath
                        ? tmdbImageUrl(credit.posterPath, "w500")
                        : null,
                      name: credit.name,
                    }}
                    className="flex items-baseline gap-3 px-4 py-2 text-sm hover:bg-well/60"
                  >
                    <span className="w-10 shrink-0 text-xs text-faint tabular-nums">
                      {credit.date?.slice(0, 4) ?? "TBA"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-ink">{credit.name}</span>
                      {credit.character && (
                        <span className="text-muted">
                          {" "}
                          as {credit.character}
                        </span>
                      )}
                    </span>
                    {status && (
                      <span className="shrink-0 text-xs text-accent">
                        {STATUS_LABELS[credit.mediaType][status]}
                      </span>
                    )}
                    <span className="shrink-0 text-xs text-faint">
                      {credit.mediaType === "movie"
                        ? "Movie"
                        : `TV${
                            credit.episodeCount
                              ? ` · ${credit.episodeCount} ep${
                                  credit.episodeCount === 1 ? "" : "s"
                                }`
                              : ""
                          }`}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </DetailPage>
  );
}

/** A credit's poster linking to its detail page, with the cover tagged for
 *  the shared view transition while that navigation runs. */
function PosterCard({
  credit,
  status,
}: {
  credit: PersonCredit;
  status: ItemStatus | undefined;
}) {
  const href = creditHref(credit);
  const isTransitioning = useViewTransitionState(href);
  const coverUrl = credit.posterPath
    ? tmdbImageUrl(credit.posterPath, "w342")
    : null;
  return (
    <Link
      to={href}
      viewTransition
      state={{ coverUrl, name: credit.name }}
      className="group flex w-28 shrink-0 snap-start flex-col gap-1.5"
    >
      <div className="relative">
        <MediaCover
          coverUrl={coverUrl}
          name={credit.name}
          width={112}
          viewTransitionName={
            isTransitioning
              ? mediaCoverTransitionName(
                  credit.mediaType,
                  String(credit.tmdbId),
                )
              : undefined
          }
        />
        {status && (
          <span
            title={STATUS_LABELS[credit.mediaType][status]}
            className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-accent text-accent-ink shadow"
          >
            <IconCheck className="size-3" />
          </span>
        )}
      </div>
      <div className="min-w-0 text-xs leading-snug">
        <p className="line-clamp-2 font-medium text-ink group-hover:text-accent">
          {credit.name}
        </p>
        {credit.character && (
          <p className="truncate text-faint" title={credit.character}>
            {credit.character}
          </p>
        )}
      </div>
    </Link>
  );
}
