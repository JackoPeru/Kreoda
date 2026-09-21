import { useState } from "react";
import { parseLengthToMm } from "@kreoda/units";
import { executeCommand } from "../commands/execute";
import { isSketchId, useSelectionStore } from "../stores";
import { CadActions, CadDialog } from "./CadDialog";

/** Extrude the selected sketch (§20 Tier 4): distance dialog → solid. */
export function ExtrudeDialog({ onClose }: { onClose: () => void }) {
  const [distance, setDistance] = useState("20");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedIds = useSelectionStore((s) => s.selectedIds);

  const submit = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const distanceMm = parseLengthToMm(distance);
      // Only a sketch noun may be extruded — a body UUID here would fail
      // confusingly in the core ("unknown sketch").
      const sketchId = selectedIds.find((id) => isSketchId(id));
      if (!sketchId) throw new Error("Select a sketch first");
      await executeCommand("CreateExtrude", { sketchId, distanceMm });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "extrude failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <CadDialog
      title="Pull sketch into solid"
      description="Blind extrude along the sketch normal (one Undo step)."
      onClose={onClose}
      error={error}
      actions={
        <CadActions
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          busyLabel="Building…"
          label="Extrude"
        />
      }
    >
      <label className="mb-2 block text-xs text-white/70">
        Distance (mm)
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
