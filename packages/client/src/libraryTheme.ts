export const LIBRARY_THEMES = [
  "classic",
  "black",
  "oak",
  "walnut",
] as const;

export type LibraryTheme = (typeof LIBRARY_THEMES)[number];

export const DEFAULT_LIBRARY_THEME: LibraryTheme = "classic";

const LIBRARY_THEME_KEY = "shelfie.libraryTheme";

function isLibraryTheme(value: string | null): value is LibraryTheme {
  return (LIBRARY_THEMES as readonly string[]).includes(value ?? "");
}

export function getLibraryTheme(): LibraryTheme {
  if (typeof localStorage === "undefined") return DEFAULT_LIBRARY_THEME;

  try {
    const theme = localStorage.getItem(LIBRARY_THEME_KEY);
    return isLibraryTheme(theme) ? theme : DEFAULT_LIBRARY_THEME;
  } catch {
    return DEFAULT_LIBRARY_THEME;
  }
}

export function setLibraryTheme(theme: LibraryTheme): void {
  if (typeof localStorage === "undefined") return;

  try {
    localStorage.setItem(LIBRARY_THEME_KEY, theme);
  } catch {
    // Storage can be unavailable in privacy modes; keep the in-memory choice.
  }
}
