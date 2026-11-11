import type { FunctionComponent, ReactNode, SVGProps } from "react";
import { useId, useState } from "react";
import clsx from "clsx";
import IconChevronDown from "~icons/tabler/chevron-down";
import IconChevronRight from "~icons/tabler/chevron-right";

/** One contextual-slot row: a fixed-width muted label, then its control on
 *  the same line (Rating, Excitement). The fixed label width lines the
 *  controls up when two rows stack. */
export function LogFieldRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-8 items-center gap-2 px-2 text-sm">
      <span className="max-w-20 shrink-0 font-medium text-muted">{label}</span>
      {children}
    </div>
  );
}

/** A collapsed summary row (icon, label, one-line value, chevron) that
 *  expands inline to reveal its editor — the popup's Platform/Notes rows. */
export function LogDisclosureRow({
  icon: Icon,
  label,
  summary,
  children,
}: {
  icon: FunctionComponent<SVGProps<SVGSVGElement>>;
  label: string;
  /** Collapsed-state preview; rendered muted by the caller when empty. */
  summary: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const Chevron = open ? IconChevronDown : IconChevronRight;
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className={clsx(
          "flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-bg",
          open && "bg-bg",
        )}
      >
        <Icon className="shrink-0 text-muted" />
        <span className="shrink-0 font-medium text-ink">{label}</span>
        <span className="ml-2 min-w-0 grow truncate text-right text-xs text-muted">
          {summary}
        </span>
        <Chevron className="shrink-0 text-faint" />
      </button>
      {open && (
        <div id={panelId} className="px-2 pt-2 pb-1">
          {children}
        </div>
      )}
    </div>
  );
}
