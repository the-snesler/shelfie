import type { LibraryItem } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { StarRating } from "../detail/StarRating";

export function LogRatingSection({
  item,
  onChange,
}: {
  item: RxDocument<LibraryItem> | null;
  onChange: (value: number | null) => void;
}) {
  if (!item) return null;

  return (
    <div className="flex flex-col gap-1 text-sm font-medium text-muted">
      Rating
      <StarRating value={item.rating} onChange={onChange} />
    </div>
  );
}
