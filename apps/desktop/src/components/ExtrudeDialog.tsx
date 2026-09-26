import { useState } from "react";
import { parseLengthToMm } from "@kreoda/units";
import { executeCommand } from "../commands/execute";
import { isSketchId, useSelectionStore } from "../stores";
import { CadActions, CadDialog } from "./CadDialog";
import { t, useT } from "../i18n";

/** Extrude the selected sketch (§20 Tier 4): distance dialog → solid. */
export function ExtrudeDialog({ onClose }: { onClose: () => void }) {
  const [distance, setDistance] = useState("20");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const tt = useT();

  const submit = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const distanceMm = parseLengthToMm(distance);
      // Only a sketch noun may be extruded — a body UUID here would fail
      // confusingly in the core ("unknown sketch").
      const sketchId = selectedIds.find((id) => isSketchId(id));
      if (!sketchId) throw new Error(tt("extrude.errNoSketch"));
      await executeCommand("CreateExtrude", { sketchId, distanceMm });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("extrude.errFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CadDialog
      title={tt("extrude.title")}
      description={tt("extrude.desc")}
      onClose={onClose}
      error={error}
      actions={
        <CadActions
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          busyLabel={tt("common.building")}
          label={tt("extrude.action")}
        />
      }
    >
      <label className="mb-2 block text-xs text-white/70">
        {tt("extrude.distance")}
        <input
          defaultValue={distance}
          onChange={(e) => setDistance(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          className="mt-1 w-full rounded-md bg-white/5 px-2.5 py-1.5 text-sm text-white outline-none focus:bg-white/10"
        />
      </label>
    </CadDialog>
  );
}
