import IconX from "~icons/tabler/x";

export function LogHeader({
  targetName,
  onClose,
}: {
  targetName: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-lg font-semibold text-ink">{targetName}</h2>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="text-muted hover:text-ink"
      >
        <IconX />
      </button>
    </div>
  );
}
