/** Server-owned source connections; credentials never enter library replication. */
export const IMPORT_SOURCES = ["trakt", "bookorbit", "steam"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
  warnings: string[];
}

export interface ImportConnection {
  source: ImportSource;
  enabled: boolean;
  /** Five-field UTC cron expression; empty disables periodic imports. */
  schedule: string;
  account: string;
  baseUrl: string;
  hasApiKey: boolean;
  hasAccessToken: boolean;
  running: boolean;
  lastRunAt: number | null;
  lastError: string | null;
  lastResult: ImportResult | null;
}

export interface ImportConnectionInput {
  enabled: boolean;
  schedule: string;
  account: string;
  baseUrl: string;
  /** Omit to preserve the saved credential; empty string clears it. */
  apiKey?: string;
  accessToken?: string;
}
