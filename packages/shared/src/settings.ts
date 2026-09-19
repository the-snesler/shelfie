export const LIBRARY_THEMES = ["classic", "black", "oak", "walnut"] as const;

export type LibraryTheme = (typeof LIBRARY_THEMES)[number];

export const DEFAULT_LIBRARY_THEME: LibraryTheme = "classic";

export interface OwnerPreferences {
  libraryTheme: LibraryTheme;
  showProgressBars: boolean;
}

export interface OwnerSettings extends OwnerPreferences {
  username: string;
}
