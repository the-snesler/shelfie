/**
 * HTTP-only types for the person (actor) endpoint, backed by TMDB's
 * /person/{id} with combined credits. Never synced. The numeric TMDB person
 * id is the stable key (drives /people/<id>); cast credits on movie and TV
 * detail carry it as `CastMember.id`.
 */

/** One acting credit, movie or TV. */
export interface PersonCredit {
  mediaType: "movie" | "tv";
  /** TMDB id of the movie or show (drives /movies/<id> or /tv/<id>). */
  tmdbId: number;
  name: string;
  /** Role(s); several TV roles are joined with " / ". */
  character: string | null;
  /** ISO "YYYY-MM-DD" release / first air date; null when unknown. */
  date: string | null;
  posterPath: string | null;
  /** TV only: episodes this person appeared in. */
  episodeCount: number | null;
  /** TMDB vote count, a stable popularity proxy for "known for". */
  voteCount: number;
}

/** Served by GET /api/people/by-id/:id. */
export interface PersonDetail {
  tmdbId: number;
  name: string;
  profilePath: string | null;
  biography: string | null;
  /** ISO "YYYY-MM-DD"; null when unknown. */
  birthday: string | null;
  deathday: string | null;
  placeOfBirth: string | null;
  /** e.g. "Acting", "Directing". */
  knownForDepartment: string | null;
  imdbId: string | null;
  /** Acting credits, newest first (undated/upcoming first of all). Talk,
   *  news and "Self" appearances are dropped. */
  credits: PersonCredit[];
}
