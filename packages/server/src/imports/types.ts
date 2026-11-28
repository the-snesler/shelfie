import type {
  ImportSourceCapabilities,
  ItemStatus,
  LogFormat,
  MediaType,
  Moment,
  Storefront,
} from "@tsundo/shared";

export interface ImportedItem {
  mediaType: MediaType;
  sourceId: string;
  status: ItemStatus;
  progressFormat?: LogFormat;
  progressValue?: number | null;
  rating?: number | null;
  /** When each completion finished (see shared `Moment`). Instants must
   *  mark the end of the watch/read/play, not its start. */
  completions?: Moment[];
  /** Episode key → when it finished, as for `completions`; "" = unknown. */
  watchedEpisodes?: Record<string, Moment | "">;
  platforms?: string[];
  storefront?: Storefront;
  /** The source's title, for previews and logs; never written to the library. */
  title?: string;
  /** ISO day of the entry's latest activity in the source, when it has one. */
  activityDay?: string;
}

export interface SourceConfig {
  account: string;
  baseUrl: string;
  apiKey: string;
  accessToken: string;
}

export interface SourceData {
  items: ImportedItem[];
  skipped: number;
  /** Entries the adapter left out early because the policy excludes them. */
  filtered?: number;
  warnings: string[];
  /** The account the credentials belong to, when the source reports it. */
  account?: string;
}

/** What an adapter knows about an entry before resolving its catalog id. */
export type EntryInfo = Pick<
  ImportedItem,
  "mediaType" | "status" | "activityDay"
>;

/**
 * The import policy as a predicate. Adapters may call it before expensive
 * per-entry lookups (IGDB, Goodreads); the service applies it again to every
 * returned item, so calling it is an optimization, never a requirement.
 */
export type EntryFilter = (entry: EntryInfo) => boolean;

/** The one seam every import source implements. */
export interface ImportAdapter<Deps> {
  capabilities: ImportSourceCapabilities;
  /**
   * Checks and normalizes a connection about to be saved, given the saved
   * one; throws an `Error` with a user-facing message.
   */
  normalizeConfig(next: SourceConfig, previous: SourceConfig): SourceConfig;
  fetch(
    config: SourceConfig,
    deps: Deps,
    wants: EntryFilter,
  ): Promise<SourceData>;
}
