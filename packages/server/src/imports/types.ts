import type { ItemStatus, LogFormat, MediaType } from "@shelfie/shared";

export interface ImportedItem {
  mediaType: MediaType;
  sourceId: string;
  status: ItemStatus;
  progressFormat?: LogFormat;
  progressValue?: number | null;
  rating?: number | null;
  completedDates?: string[];
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
