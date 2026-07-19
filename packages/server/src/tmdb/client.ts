import type {
  CastMember,
  MediaVideo,
  MovieDetail,
  MovieMetadata,
  MovieSearchResult,
  TvDetail,
  TvMetadata,
  TvSearchResult,
  TvSeason,
} from "@shelfie/shared";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

/** TMDB's unofficial ceiling is ~40-50 req/s; self-throttle well under it. */
const MIN_REQUEST_INTERVAL_MS = 100;
let requestQueue: Promise<void> = Promise.resolve();

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function throttle(): Promise<void> {
  const next = requestQueue.then(() => delay(MIN_REQUEST_INTERVAL_MS));
  requestQueue = next;
  return next;
}

/** Requests TMDB with a Retry-After-aware 429 retry-once. */
async function tmdbFetch(
  path: string,
  params?: Record<string, string>,
  retried = false,
): Promise<Response> {
  await throttle();
  const url = new URL(`${TMDB_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.TMDB_TOKEN ?? ""}`,
      accept: "application/json",
    },
  });
  if (res.status === 429 && !retried) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs =
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000;
    await delay(waitMs);
    return tmdbFetch(path, params, true);
  }
  return res;
}

async function tmdbGet<T>(
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const res = await tmdbFetch(path, params);
  if (!res.ok) {
    throw new Error(
      `TMDB request failed: ${path} -> ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as T;
}

interface TmdbGenre {
  name: string;
}

interface TmdbSearchMovie {
  id: number;
  title: string;
  release_date: string;
  poster_path: string | null;
}

interface TmdbSearchTv {
  id: number;
  name: string;
  first_air_date: string;
  poster_path: string | null;
}

interface TmdbSearchResponse<T> {
  results: T[];
}

interface TmdbCrewMember {
  name: string;
  job: string;
}

interface TmdbCastMember {
  name: string;
  character: string;
  profile_path: string | null;
}

interface TmdbCredits {
  cast: TmdbCastMember[];
  crew: TmdbCrewMember[];
}

interface TmdbReleaseDateEntry {
  certification: string;
  type: number;
}

interface TmdbReleaseDatesResult {
  iso_3166_1: string;
  release_dates: TmdbReleaseDateEntry[];
}

interface TmdbReleaseDates {
  results: TmdbReleaseDatesResult[];
}

interface TmdbVideo {
  key: string;
  name: string;
  site: string;
}

interface TmdbVideos {
  results: TmdbVideo[];
}

interface TmdbExternalIds {
  imdb_id: string | null;
}

interface TmdbMovie {
  id: number;
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
  genres: TmdbGenre[];
  release_date: string;
  runtime: number | null;
  overview: string | null;
  tagline: string | null;
  vote_average: number | null;
  vote_count: number | null;
  imdb_id: string | null;
  credits?: TmdbCredits;
  videos?: TmdbVideos;
  release_dates?: TmdbReleaseDates;
  external_ids?: TmdbExternalIds;
}

interface TmdbSeasonSummary {
  season_number: number;
}

interface TmdbNamed {
  name: string;
}

interface TmdbAggregateRole {
  character: string;
}

interface TmdbAggregateCastMember {
  name: string;
  profile_path: string | null;
  roles: TmdbAggregateRole[];
}

interface TmdbAggregateCredits {
  cast: TmdbAggregateCastMember[];
}

interface TmdbTv {
  id: number;
  name: string;
  poster_path: string | null;
  backdrop_path: string | null;
  genres: TmdbGenre[];
  first_air_date: string;
  last_air_date: string | null;
  status: string | null;
  number_of_seasons: number;
  number_of_episodes: number;
  networks: TmdbNamed[];
  created_by: TmdbNamed[];
  overview: string | null;
  tagline: string | null;
  vote_average: number | null;
  vote_count: number | null;
  in_production: boolean;
  seasons: TmdbSeasonSummary[];
  aggregate_credits?: TmdbAggregateCredits;
  videos?: TmdbVideos;
  external_ids?: TmdbExternalIds;
}

interface TmdbContentRatingEntry {
  iso_3166_1: string;
  rating: string;
}

interface TmdbContentRatings {
  results: TmdbContentRatingEntry[];
}

interface TmdbEpisode {
  season_number: number;
  episode_number: number;
  name: string;
  air_date: string | null;
  runtime: number | null;
  still_path: string | null;
}

interface TmdbSeason {
  season_number: number;
  name: string;
  air_date: string | null;
  poster_path: string | null;
  episodes: TmdbEpisode[];
}

/** TMDB uses "" (not null) for an unknown release/air date; guard both. */
function yearFromDate(date: string | null | undefined): number | null {
  if (!date) return null;
  const year = Number(date.slice(0, 4));
  return Number.isFinite(year) && year > 0 ? year : null;
}

function extractDirector(crew: TmdbCrewMember[] | undefined): string | null {
  return crew?.find((member) => member.job === "Director")?.name ?? null;
}

function extractVideos(videos: TmdbVideos | undefined): MediaVideo[] {
  return (videos?.results ?? [])
    .filter((video) => video.site === "YouTube")
    .map((video) => ({ videoId: video.key, name: video.name || null }));
}

function extractMovieCertification(
  releaseDates: TmdbReleaseDates | undefined,
): string | null {
  const us = releaseDates?.results.find((result) => result.iso_3166_1 === "US");
  if (!us) return null;
  const rated = us.release_dates.filter(
    (entry) => entry.certification.trim().length > 0,
  );
  if (rated.length === 0) return null;
  const theatrical = rated.find((entry) => entry.type === 3);
  return (theatrical ?? rated[0]).certification;
}

function extractCast(cast: TmdbCastMember[] | undefined): CastMember[] {
  return (cast ?? []).slice(0, 20).map((member) => ({
    name: member.name,
    character: member.character || null,
    profilePath: member.profile_path,
  }));
}

function extractAggregateCast(
  cast: TmdbAggregateCastMember[] | undefined,
): CastMember[] {
  return (cast ?? []).slice(0, 20).map((member) => ({
    name: member.name,
    character: member.roles[0]?.character || null,
    profilePath: member.profile_path,
  }));
}

function extractTvCertification(ratings: TmdbContentRatings): string | null {
  return (
    ratings.results.find((result) => result.iso_3166_1 === "US")?.rating || null
  );
}

function movieToMetadata(movie: TmdbMovie): MovieMetadata {
  return {
    tmdbId: movie.id,
    name: movie.title,
    posterPath: movie.poster_path,
    genres: (movie.genres ?? []).map((genre) => genre.name),
    year: yearFromDate(movie.release_date),
    director: extractDirector(movie.credits?.crew),
    runtime: movie.runtime && movie.runtime > 0 ? movie.runtime : null,
    summary: movie.overview || null,
  };
}

function tvToMetadata(tv: TmdbTv): TvMetadata {
  return {
    tmdbId: tv.id,
    name: tv.name,
    posterPath: tv.poster_path,
    genres: (tv.genres ?? []).map((genre) => genre.name),
    firstAirYear: yearFromDate(tv.first_air_date),
    status: tv.status ?? null,
    numberOfSeasons: tv.number_of_seasons ?? 0,
    numberOfEpisodes: tv.number_of_episodes ?? 0,
    networks: (tv.networks ?? []).map((network) => network.name),
    createdBy: (tv.created_by ?? []).map((creator) => creator.name),
    summary: tv.overview || null,
  };
}

export async function searchMovies(q: string): Promise<MovieSearchResult[]> {
  const data = await tmdbGet<TmdbSearchResponse<TmdbSearchMovie>>(
    "/search/movie",
    {
      query: q,
      include_adult: "false",
    },
  );
  return data.results.slice(0, 20).map((movie) => ({
    tmdbId: movie.id,
    name: movie.title,
    year: yearFromDate(movie.release_date),
    posterPath: movie.poster_path,
  }));
}

export async function searchTv(q: string): Promise<TvSearchResult[]> {
  const data = await tmdbGet<TmdbSearchResponse<TmdbSearchTv>>("/search/tv", {
    query: q,
    include_adult: "false",
  });
  return data.results.slice(0, 20).map((tv) => ({
    tmdbId: tv.id,
    name: tv.name,
    year: yearFromDate(tv.first_air_date),
    posterPath: tv.poster_path,
  }));
}

export async function fetchMovieCard(id: number): Promise<MovieMetadata> {
  const movie = await tmdbGet<TmdbMovie>(`/movie/${id}`, {
    append_to_response: "credits",
  });
  return movieToMetadata(movie);
}

export async function fetchMovieDetail(id: number): Promise<MovieDetail> {
  const movie = await tmdbGet<TmdbMovie>(`/movie/${id}`, {
    append_to_response: "credits,videos,release_dates,external_ids",
  });
  return {
    ...movieToMetadata(movie),
    backdropPath: movie.backdrop_path,
    tagline: movie.tagline || null,
    certification: extractMovieCertification(movie.release_dates),
    voteAverage: movie.vote_average ?? null,
    voteCount: movie.vote_count ?? 0,
    videos: extractVideos(movie.videos),
    cast: extractCast(movie.credits?.cast),
    imdbId: movie.imdb_id ?? movie.external_ids?.imdb_id ?? null,
  };
}

export async function fetchTvCard(id: number): Promise<TvMetadata> {
  const tv = await tmdbGet<TmdbTv>(`/tv/${id}`);
  return tvToMetadata(tv);
}

async function fetchTvSeason(
  showId: number,
  seasonNumber: number,
): Promise<TvSeason> {
  const season = await tmdbGet<TmdbSeason>(
    `/tv/${showId}/season/${seasonNumber}`,
  );
  return {
    seasonNumber: season.season_number,
    name: season.name,
    airDate: season.air_date ?? null,
    posterPath: season.poster_path,
    episodes: (season.episodes ?? []).map((episode) => ({
      seasonNumber: episode.season_number,
      episodeNumber: episode.episode_number,
      name: episode.name,
      airDate: episode.air_date ?? null,
      runtime: episode.runtime ?? null,
      stillPath: episode.still_path,
    })),
  };
}

export async function fetchTvDetail(id: number): Promise<TvDetail> {
  const [tv, contentRatings] = await Promise.all([
    tmdbGet<TmdbTv>(`/tv/${id}`, {
      append_to_response: "aggregate_credits,videos,external_ids",
    }),
    tmdbGet<TmdbContentRatings>(`/tv/${id}/content_ratings`),
  ]);
  const seasons = await Promise.all(
    (tv.seasons ?? []).map((season) => fetchTvSeason(id, season.season_number)),
  );
  seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
  return {
    ...tvToMetadata(tv),
    backdropPath: tv.backdrop_path,
    tagline: tv.tagline || null,
    certification: extractTvCertification(contentRatings),
    voteAverage: tv.vote_average ?? null,
    voteCount: tv.vote_count ?? 0,
    videos: extractVideos(tv.videos),
    cast: extractAggregateCast(tv.aggregate_credits?.cast),
    seasons,
    lastAirDate: tv.last_air_date ?? null,
    inProduction: tv.in_production ?? false,
    imdbId: tv.external_ids?.imdb_id ?? null,
  };
}
