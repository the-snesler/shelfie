import type { LibraryItem } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { StarRating } from "../detail/StarRating";
import { LogFieldRow } from "./LogRows";

export function LogRatingSection({
  item,
  onChange,
}: {
  item: RxDocument<LibraryItem> | null;
  onChange: (value: number | null) => void;
}) {
  if (!item) return null;

  return (
    <LogFieldRow label="Rating">
      <StarRating value={item.rating} onChange={onChange} />
    </LogFieldRow>
  );
}
