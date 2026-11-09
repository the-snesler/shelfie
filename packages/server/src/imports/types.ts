import type { ItemStatus, LogFormat, MediaType } from "@shelfie/shared";

export interface ImportedItem {
  mediaType: MediaType;
  sourceId: string;
  status: ItemStatus;
  progressFormat?: LogFormat;
  progressValue?: number | null;
  rating?: number | null;
  completedDates?: string[];
  /** Used only while the merged item is finished and has no completion date,
   *  for sources that know when reading stopped but not when it finished. */
  fallbackCompletedDate?: string;
  watchedEpisodes?: Record<string, string>;
  platforms?: string[];
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
  warnings: string[];
}
