/** HTTP-only settings; integration secrets never enter library replication. */
export interface CalendarSubscriptionSettings {
  enabled: boolean;
  createdAt: number | null;
}

export interface CreatedCalendarSubscription extends CalendarSubscriptionSettings {
  /** Revealed once on creation/rotation. */
  path: string;
}

export interface NotificationSettings {
  enabled: boolean;
  /** Apprise API base URL, e.g. http://apprise:8000. */
  endpoint: string;
  destinationsConfigured: boolean;
  daysBefore: number;
  pending: number;
  failed: number;
  lastSentAt: number | null;
}

export interface NotificationSettingsUpdate {
  enabled: boolean;
  endpoint: string;
  /** Omit to retain existing destinations; empty clears them. */
  destinations?: string;
  daysBefore: number;
}
