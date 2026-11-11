import type { LibraryItem } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { ExcitementMeter } from "./ExcitementMeter";
import { LogFieldRow } from "./LogRows";

/** The planned-group counterpart of `LogRatingSection`. */
export function LogExcitementSection({
  item,
  onChange,
}: {
  item: RxDocument<LibraryItem> | null;
  onChange: (value: number | null) => void;
}) {
  if (!item) return null;

  return (
    <LogFieldRow label="Excitement">
      <ExcitementMeter value={item.excitement} onChange={onChange} />
    </LogFieldRow>
  );
}
