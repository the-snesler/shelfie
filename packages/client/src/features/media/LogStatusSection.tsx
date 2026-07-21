import clsx from "clsx";
import {
  COMPLETION_STATUSES,
  META_STATUS_LABELS,
  STATUS_ICONS,
} from "./status";
import type { ItemStatus, MetaStatus } from "@shelfie/shared";
import { Fragment } from "react/jsx-runtime";
import IconChevronRight from "~icons/tabler/chevron-right";

export function LogStatusSection({
  statuses,
  labels,
  activeStatus,
  onSelectStatus,
}: {
  statuses: readonly [MetaStatus, ItemStatus[]][];
  labels: Record<ItemStatus, string>;
  activeStatus: ItemStatus | null;
  onSelectStatus: (status: ItemStatus) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {statuses.map((group) => {
        return (
          <Fragment key={group.join(",")}>
            <h3 className="text-xs mt-1 font-medium text-muted">
              {META_STATUS_LABELS[group[0]]}
            </h3>
            {group[1].map((status) => {
              const Icon = STATUS_ICONS[status];
              const active = activeStatus === status;
              const shouldShowCaret = COMPLETION_STATUSES[status];
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => onSelectStatus(status)}
                  className={clsx(
                    "flex items-center gap-2 rounded px-3 py-2 text-sm font-medium grow",
                    active
                      ? "bg-accent text-accent-ink"
                      : "bg-bg text-ink ring-1 ring-divider",
                  )}
                >
                  <Icon />
                  {labels[status]}
                  {shouldShowCaret && <IconChevronRight className="ml-auto" />}
                </button>
              );
            })}
          </Fragment>
        );
      })}
    </div>
  );
}
