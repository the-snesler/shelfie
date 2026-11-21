import type { Storefront } from "@shelfie/shared";
import IconBuildingStore from "~icons/tabler/building-store";
import {
  hasStorefrontPlatform,
  STOREFRONT_LABELS,
  STOREFRONTS,
} from "../games/storefronts";
import { LogDisclosureRow } from "./LogRows";

/** Games owned on PC/Mac/Linux/DOS only: a summary row naming the store the
 *  game was bought on, expanding into single-select store chips (pressing
 *  the selected chip clears it). */
export function LogStorefrontSection({
  mediaType,
  selectedPlatforms,
  storefront,
  onChange,
}: {
  mediaType: string;
  selectedPlatforms: readonly string[];
  storefront: Storefront | null;
  onChange: (storefront: Storefront | null) => void;
}) {
  if (mediaType !== "game" || !hasStorefrontPlatform(selectedPlatforms)) {
    return null;
  }

  return (
    <LogDisclosureRow
      icon={IconBuildingStore}
      label="Store"
      summary={
        storefront ? (
          STOREFRONT_LABELS[storefront]
        ) : (
          <span className="text-faint">None</span>
        )
      }
    >
      <div role="group" aria-label="Store" className="flex flex-wrap gap-2">
        {STOREFRONTS.map((store) => (
          <button
            key={store}
            type="button"
            aria-pressed={storefront === store}
            onClick={() => onChange(storefront === store ? null : store)}
            className={
              storefront === store
                ? "rounded bg-accent px-2 py-1 text-xs font-medium text-accent-ink"
                : "rounded bg-bg px-2 py-1 text-xs text-ink ring-1 ring-divider"
            }
          >
            {STOREFRONT_LABELS[store]}
          </button>
        ))}
      </div>
    </LogDisclosureRow>
  );
}
