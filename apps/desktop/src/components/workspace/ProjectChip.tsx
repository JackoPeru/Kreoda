// UX-1 project chip: logo + document summary, opens the project drawer.
// Display-only data (counts) — never a fake save-state indicator.
import { useDocumentUiStore, useSelectionStore } from "../../stores";

export function ProjectChip({ onOpen }: { onOpen: () => void }) {
  const featureCount = useDocumentUiStore((s) => s.features.length);
  const sketchCount = useDocumentUiStore((s) => s.sketches.length);
  const selected = useSelectionStore((s) => s.selectedIds.length);
  const count = featureCount + sketchCount;
  const sub =
    selected > 0
      ? `${selected} selected`
      : count === 0
        ? "Empty"
        : `${count} item${count > 1 ? "s" : ""}`;

  return (
    <button
      onClick={onOpen}
      aria-label="Project"
      title="Project — objects, sketches, history"
      data-testid="project-chip"
      className="flex min-w-0 items-center gap-2 rounded-[var(--kreoda-radius-sm)] px-2 py-1 hover:bg-white/10"
    >
      <img
        src="kreoda-mark.png"
        alt=""
        aria-hidden
        className="h-6 w-6 shrink-0 rounded-sm"
      />
      <span className="flex min-w-0 flex-col items-start leading-tight">
        <span className="text-sm font-semibold tracking-wide">KREODA</span>
        <span className="max-w-32 truncate text-[11px] text-white/45">
          {sub}
        </span>
      </span>
    </button>
  );
}
