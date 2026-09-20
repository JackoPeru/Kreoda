import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { parseLengthToMm } from "@intentcad/units";
import { executeCommand } from "../commands/execute";
import { isSketchId, useSelectionStore } from "../stores";

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
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/3 w-80 -translate-x-1/2 rounded-lg border border-white/15 bg-[#141922] p-4">
          <Dialog.Title className="text-sm font-semibold">
            {isFillet ? "Round edge" : "Cut corner"}
          </Dialog.Title>
          <Dialog.Description className="pb-3 text-xs text-white/55">
            {edgeIds.length === 0
              ? "Select one or more edges first (Edge filter, Ctrl+click)."
              : `${edgeIds.length} edge${edgeIds.length > 1 ? "s" : ""} selected.`}
          </Dialog.Description>
          <label className="mb-2 block text-xs text-white/70">
            {isFillet ? "Radius (mm)" : "Distance (mm)"}
            <input
              defaultValue={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
              className="mt-1 w-full rounded-md bg-white/5 px-2.5 py-1.5 text-sm text-white outline-none focus:bg-white/10"
            />
          </label>
          {error && <div className="pb-2 text-xs text-red-300">{error}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-white/70 hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              onClick={() => void submit()}
              disabled={busy || edgeIds.length === 0 || mixed}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
            >
              {busy ? "Building…" : isFillet ? "Round" : "Chamfer"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
