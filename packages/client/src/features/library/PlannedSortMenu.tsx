import { Menu } from "@base-ui/react/menu";
import IconArrowsSort from "~icons/tabler/arrows-sort";
import IconCheck from "~icons/tabler/check";
import type { PlannedSort } from "./librarySorting";

export const PLANNED_SORT_OPTIONS: readonly [PlannedSort, string][] = [
  ["manual", "Manual"],
  ["recent", "Last interaction"],
  ["release", "Release date"],
  ["excitement", "Excitement"],
  ["title", "A–Z"],
  ["type", "Type"],
];

/** The planned header's sort control: an icon trigger opening a small
 *  radio menu (Base UI, positioned by floating-ui) that fades and scales in
 *  from the trigger. Picking an option closes the menu. */
export function PlannedSortMenu({
  value,
  onChange,
}: {
  value: PlannedSort;
  onChange: (sort: PlannedSort) => void;
}) {
  const label =
    PLANNED_SORT_OPTIONS.find(([sort]) => sort === value)?.[1] ?? "";
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`Sort planned items (${label})`}
        title={`Sort: ${label}`}
        className="inline-flex rounded p-1.5 text-muted transition-colors hover:bg-well hover:text-accent data-popup-open:bg-well data-popup-open:text-accent"
      >
        <IconArrowsSort className="size-5" aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6}>
          <Menu.Popup className="min-w-44 origin-(--transform-origin) rounded-md border border-divider bg-panel p-1 shadow-xl outline-none transition-[opacity,scale] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <Menu.Group>
              <Menu.GroupLabel className="px-2 py-1.5 text-xs text-faint">
                Sort by
              </Menu.GroupLabel>
              <Menu.RadioGroup
                value={value}
                onValueChange={(next: PlannedSort) => onChange(next)}
              >
                {PLANNED_SORT_OPTIONS.map(([sort, optionLabel]) => (
                  <Menu.RadioItem
                    key={sort}
                    value={sort}
                    closeOnClick
                    className="flex cursor-default items-center gap-6 rounded px-2 py-1.5 text-sm text-ink outline-none select-none data-highlighted:bg-well data-highlighted:text-accent"
                  >
                    <span className="flex-1">{optionLabel}</span>
                    <Menu.RadioItemIndicator
                      keepMounted
                      className="text-accent data-unchecked:invisible"
                    >
                      <IconCheck className="size-4" aria-hidden />
                    </Menu.RadioItemIndicator>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Group>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
