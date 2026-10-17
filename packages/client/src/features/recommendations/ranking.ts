import type { LibraryItem, MediaType } from "@shelfie/shared";
import type { CardMeta } from "../../db/cardCache";
import { releaseDateFromEpoch } from "../media/libraryActions";

export interface Recommendation<TItem extends LibraryItem = LibraryItem> {
  item: TItem;
  card: CardMeta;
  reasons: string[];
  score: number;
}

export function isRecommendationCandidate(item: LibraryItem): boolean {
  return ["backlogged", "wishlisted", "paused"].includes(item.status);
}

interface Feature {
  key: string;
  label: string;
  kind: "genre" | "creator";
}

function features(type: MediaType, card: CardMeta): Feature[] {
  const result: Feature[] = [];
  if ("genres" in card) {
    for (const genre of card.genres) {
      result.push({ key: `genre:${genre}`, label: genre, kind: "genre" });
    }
  }
  const creators =
    type === "book" && "authors" in card
      ? card.authors
      : type === "game" && "developer" in card && card.developer
        ? [card.developer]
        : type === "movie" && "director" in card && card.director
          ? [card.director]
          : [];
  for (const name of creators) {
    result.push({ key: `creator:${name}`, label: name, kind: "creator" });
  }
  const unique = new Map<string, Feature>();
  for (const feature of result) {
    if (!feature.label.trim()) continue;
    const label = feature.label.trim();
    const key = `${type}:${feature.kind}:${label.toLowerCase()}`;
    unique.set(key, { ...feature, key, label });
  }
  return [...unique.values()];
}

function releaseDate(card: CardMeta): string | null {
  if ("firstReleaseDate" in card)
    return releaseDateFromEpoch(card.firstReleaseDate);
  if ("releaseDate" in card) return card.releaseDate;
  if ("publicationDate" in card) return card.publicationDate;
  if ("firstAirYear" in card && card.firstAirYear)
    return `${card.firstAirYear}-01-01`;
  return null;
}

/** An explainable shelf picker: only ratings of 4+ contribute preference
 * evidence, only queued/paused titles are candidates, and future releases
 * stay on the calendar. Never invents a match when metadata is missing. */
export function rankRecommendations<TItem extends LibraryItem>(
  items: readonly TItem[],
  cards: ReadonlyMap<string, CardMeta>,
  {
    today,
    mediaType,
    limit = 24,
  }: { today: string; mediaType?: MediaType; limit?: number },
): Recommendation<TItem>[] {
  const preferences = new Map<
    string,
    { id: string; rating: number; title: string }[]
  >();
  for (const item of items) {
    if (item.rating == null || item.rating < 4 || item.status === "dropped")
      continue;
    const card = cards.get(item.id);
    if (!card) continue;
    for (const feature of features(item.mediaType, card)) {
      const examples = preferences.get(feature.key) ?? [];
      examples.push({ id: item.id, rating: item.rating, title: card.name });
      preferences.set(feature.key, examples);
    }
  }

  const picks: Recommendation<TItem>[] = [];
  for (const item of items) {
    if (!isRecommendationCandidate(item)) continue;
    if (mediaType && item.mediaType !== mediaType) continue;
    const card = cards.get(item.id);
    if (!card) continue;
    const release = releaseDate(card);
    if (release && release > today) continue;

    const matches = features(item.mediaType, card)
      .map((feature) => {
        // A candidate's own rating must not serve as its recommendation
        // evidence. Keep an actual different title behind every reason.
        const examples = (preferences.get(feature.key) ?? [])
          .filter((example) => example.id !== item.id)
          .sort(
            (a, b) => b.rating - a.rating || a.title.localeCompare(b.title),
          );
        const example = examples[0];
        if (!example) return null;
        const weight = Math.min(
          6,
          examples.reduce((total, entry) => total + entry.rating - 3, 0),
        );
        return {
          weight: weight * (feature.kind === "creator" ? 5 : 2),
          reason: `${feature.label}, like ${example.title} (${example.rating} stars)`,
        };
      })
      .filter((match): match is NonNullable<typeof match> => match != null)
      .sort((a, b) => b.weight - a.weight || a.reason.localeCompare(b.reason));

    const reasons = matches.slice(0, 2).map((match) => match.reason);
    if (reasons.length === 0) {
      reasons.push(
        item.status === "paused"
          ? "Pick up where you left off"
          : item.status === "wishlisted"
            ? "Waiting on your wishlist"
            : "Already in your backlog",
      );
    }
    picks.push({
      item,
      card,
      reasons,
      score:
        matches.slice(0, 3).reduce((total, match) => total + match.weight, 0) +
        (item.status === "paused" ? 1 : item.status === "backlogged" ? 0.5 : 0),
    });
  }
  return picks
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.item.updatedAt - a.item.updatedAt ||
        a.card.name.localeCompare(b.card.name) ||
        a.item.id.localeCompare(b.item.id),
    )
    .slice(0, Math.max(0, limit));
}
