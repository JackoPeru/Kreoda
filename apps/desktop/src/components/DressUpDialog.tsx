import { useState } from "react";
import { parseLengthToMm } from "@kreoda/units";
import { executeCommand } from "../commands/execute";
import { isSketchId, useSelectionStore } from "../stores";
import { CadActions, CadDialog } from "./CadDialog";

/** Round edges / cut corners over the selected edges (§20 Tier 3). */
export function DressUpDialog({
  kind,
  onClose,
}: {
  kind: "fillet" | "chamfer";
  onClose: () => void;
}) {
  const isFillet = kind === "fillet";
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const [value, setValue] = useState(isFillet ? "3" : "2");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Edge ids, excluding any sketch nouns (bodies only carry edges).
  const edgeIds = selectedIds.filter(
    (id) => id.includes(":edge.") && !isSketchId(id),
  );
  const targetId =
    edgeIds.length > 0 ? edgeIds[0]!.slice(0, edgeIds[0]!.indexOf(":")) : null;
  const mixed =
    edgeIds.length > 0 &&
    edgeIds.some((id) => id.slice(0, id.indexOf(":")) !== targetId);

  const submit = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      if (!targetId || mixed) {
        throw new Error("Select edges of a single solid");
      }
      const v = parseLengthToMm(value);
      if (isFillet) {
        await executeCommand("CreateFillet", {
          targetId,
          edgeIds,
          radiusMm: v,
        });
      } else {
        await executeCommand("CreateChamfer", {
          targetId,
          edgeIds,
          distanceMm: v,
        });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "operation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <CadDialog
      title={isFillet ? "Round edge" : "Cut corner"}
      description={
        edgeIds.length === 0
          ? "Select one or more edges first (Edge filter, Ctrl+click)."
          : `${edgeIds.length} edge${edgeIds.length > 1 ? "s" : ""} selected.`
      }
      onClose={onClose}
      error={error}
      actions={
        <CadActions
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          busyLabel="Building…"
          label={isFillet ? "Round" : "Chamfer"}
          disabled={edgeIds.length === 0 || mixed}
        />
      }
    >
      <label className="mb-2 block text-xs text-white/70">
        {isFillet ? "Radius (mm)" : "Distance (mm)"}
        <input
          defaultValue={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          className="mt-1 w-full rounded-md bg-white/5 px-2.5 py-1.5 text-sm text-white outline-none focus:bg-white/10"
        />
      </label>
    </CadDialog>
  );
}
