import { useMemo, useState } from "react";
import { executeCommand } from "../commands/execute";
import { useDocumentUiStore, useSelectionStore } from "../stores";
import { CadActions, CadDialog } from "./CadDialog";
import { featureTypeName, useT } from "../i18n";

/** Linear pattern of the selected solid along a global axis. */
export function BodyPatternDialog({ onClose }: { onClose: () => void }) {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const features = useDocumentUiStore((s) => s.features);
  const [axis, setAxis] = useState<"X" | "Y" | "Z">("X");
  const [count, setCount] = useState(3);
  const [spacing, setSpacing] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tt = useT();

  const target = useMemo(() => {
    const bare = selectedIds.find((id) => !id.includes(":"));
    if (!bare) return null;
    const feature = features.find((f) => f.featureId === bare);
    if (!feature) return null;
    return { featureId: bare, type: feature.type };
  }, [selectedIds, features]);

  const valid =
    Number.isInteger(count) &&
    count >= 2 &&
    count <= 64 &&
    Number.isFinite(spacing) &&
    Math.abs(spacing) >= 1e-6 &&
    Math.abs(spacing) <= 100000;

  const submit = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      if (!target) throw new Error(tt("pattern.errNoTarget"));
      await executeCommand("CreateBodyPattern", {
        targetId: target.featureId,
        axis,
        count,
        spacingMm: spacing,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : tt("pattern.errFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CadDialog
      title={tt("pattern.title")}
      description={
        target
          ? tt("pattern.descOn", { type: featureTypeName(target.type) })
          : tt("pattern.descOff")
      }
      onClose={onClose}
      error={error}
      testId="body-pattern-dialog"
      actions={
        <CadActions
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          busyLabel={tt("common.building")}
          label={tt("pattern.apply")}
          disabled={!target || !valid}
        />
      }
    >
      <label className="mb-2 block text-xs text-white/70">
        {tt("pattern.axis")}
        <select
          value={axis}
          onChange={(e) => setAxis(e.target.value as "X" | "Y" | "Z")}
          data-testid="body-pattern-axis"
          className="mt-1 w-full rounded-md bg-white/5 px-2 py-1.5 text-sm text-white outline-none focus:bg-white/10"
        >
          <option value="X">X</option>
          <option value="Y">Y</option>
          <option value="Z">Z</option>
        </select>
      </label>
      <label className="mb-2 block text-xs text-white/70">
        {tt("pattern.count")}
        <input
          type="number"
          min={2}
          max={64}
          step={1}
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          data-testid="body-pattern-count"
          className="mt-1 w-full rounded-md bg-white/5 px-2 py-1.5 text-sm text-white outline-none focus:bg-white/10"
        />
      </label>
      <label className="mb-2 block text-xs text-white/70">
        {tt("pattern.spacing")}
        <input
          type="number"
          step="any"
          value={spacing}
          onChange={(e) => setSpacing(Number(e.target.value))}
          data-testid="body-pattern-spacing"
          className="mt-1 w-full rounded-md bg-white/5 px-2 py-1.5 text-sm text-white outline-none focus:bg-white/10"
        />
      </label>
    </CadDialog>
  );
}
