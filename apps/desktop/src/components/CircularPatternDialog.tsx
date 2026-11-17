import { useMemo, useState } from "react";
import { executeCommand } from "../commands/execute";
import { useDocumentUiStore, useSelectionStore } from "../stores";
import { CadActions, CadDialog } from "./CadDialog";
import { featureTypeName, useT } from "../i18n";

/** Circular pattern of the selected solid around a global axis. */
export function CircularPatternDialog({ onClose }: { onClose: () => void }) {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const features = useDocumentUiStore((s) => s.features);
  const [axis, setAxis] = useState<"X" | "Y" | "Z">("Z");
  const [count, setCount] = useState(4);
  const [angle, setAngle] = useState(360);
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
    Number.isFinite(angle) &&
    angle > 0 &&
    angle <= 360;

  const submit = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      if (!target) throw new Error(tt("circular.errNoTarget"));
      await executeCommand("CreateCircularBodyPattern", {
        targetId: target.featureId,
        axis,
        count,
        angleDeg: angle,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : tt("circular.errFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CadDialog
      title={tt("circular.title")}
      description={
        target
          ? tt("circular.descOn", { type: featureTypeName(target.type) })
          : tt("circular.descOff")
      }
      onClose={onClose}
      error={error}
      testId="circular-pattern-dialog"
      actions={
        <CadActions
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          busyLabel={tt("common.building")}
          label={tt("circular.apply")}
          disabled={!target || !valid}
        />
      }
    >
      <label className="mb-2 block text-xs text-white/70">
        {tt("circular.axis")}
        <select
          value={axis}
          onChange={(e) => setAxis(e.target.value as "X" | "Y" | "Z")}
          data-testid="circular-pattern-axis"
          className="mt-1 w-full rounded-md bg-white/5 px-2 py-1.5 text-sm text-white outline-none focus:bg-white/10"
        >
          <option value="X">X</option>
          <option value="Y">Y</option>
          <option value="Z">Z</option>
        </select>
      </label>
      <label className="mb-2 block text-xs text-white/70">
        {tt("circular.count")}
        <input
          type="number"
          min={2}
          max={64}
          step={1}
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          data-testid="circular-pattern-count"
          className="mt-1 w-full rounded-md bg-white/5 px-2 py-1.5 text-sm text-white outline-none focus:bg-white/10"
        />
      </label>
      <label className="mb-2 block text-xs text-white/70">
        {tt("circular.angle")}
        <input
          type="number"
          min={1}
          max={360}
          step="any"
          value={angle}
          onChange={(e) => setAngle(Number(e.target.value))}
          data-testid="circular-pattern-angle"
          className="mt-1 w-full rounded-md bg-white/5 px-2 py-1.5 text-sm text-white outline-none focus:bg-white/10"
        />
      </label>
    </CadDialog>
  );
}
