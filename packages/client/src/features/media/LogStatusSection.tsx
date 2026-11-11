import clsx from "clsx";
import { COMPLETION_STATUSES, STATUS_ICONS } from "./status";
import type { ItemStatus } from "@shelfie/shared";
import IconChevronRight from "~icons/tabler/chevron-right";

/** Flat status menu: one light icon row per status, the selected one in
 *  the accent highlight. Completion statuses carry a chevron because
 *  picking one opens the "when did you finish it?" prompt. */
export function LogStatusSection({
  statuses,
  labels,
  activeStatus,
  onSelectStatus,
}: {
  statuses: readonly ItemStatus[];
  labels: Record<ItemStatus, string>;
  activeStatus: ItemStatus | null;
  onSelectStatus: (status: ItemStatus) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {statuses.map((status) => {
        const Icon = STATUS_ICONS[status];
        const active = activeStatus === status;
        return (
          <button
            key={status}
            type="button"
            aria-pressed={active}
            onClick={() => onSelectStatus(status)}
            className={clsx(
              "flex items-center gap-2 rounded px-2 py-1.5 text-sm",
              active
                ? "bg-accent font-medium text-accent-ink"
                : "text-ink hover:bg-bg",
            )}
          >
            <Icon className={active ? undefined : "text-muted"} />
            {labels[status]}
            {COMPLETION_STATUSES[status] && (
              <IconChevronRight
                className={clsx("ml-auto", !active && "text-faint")}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
