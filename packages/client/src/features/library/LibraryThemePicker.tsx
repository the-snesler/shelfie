import type { JSX } from "react";
import IconPalette from "~icons/tabler/palette";
import {
  LIBRARY_THEMES,
  type LibraryTheme,
} from "../../libraryTheme";

const THEME_LABELS: Record<LibraryTheme, string> = {
  classic: "Classic",
  black: "Black",
  oak: "Oak",
  walnut: "Walnut",
};

export function LibraryThemePicker({
  value,
  onChange,
}: {
  value: LibraryTheme;
  onChange: (theme: LibraryTheme) => void;
}): JSX.Element {
  return (
    <label className="ml-auto flex w-full items-center justify-end gap-2 text-sm text-muted sm:w-auto">
      <IconPalette aria-hidden="true" className="size-4" />
      <span>Theme</span>
      <select
        value={value}
        onChange={(event) =>
          onChange(event.currentTarget.value as LibraryTheme)
        }
        className="rounded-md border border-divider bg-well px-2.5 py-1.5 text-sm text-ink outline-none hover:border-muted focus:border-accent focus:ring-1 focus:ring-accent"
      >
        {LIBRARY_THEMES.map((theme) => (
          <option key={theme} value={theme}>
            {THEME_LABELS[theme]}
          </option>
        ))}
      </select>
    </label>
  );
}
