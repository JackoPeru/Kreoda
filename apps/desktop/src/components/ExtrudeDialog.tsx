import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { parseLengthToMm } from "@intentcad/units";
import { executeCommand } from "../commands/execute";
import { isSketchId, useSelectionStore } from "../stores";

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
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/3 w-80 -translate-x-1/2 rounded-lg border border-white/15 bg-[#141922] p-4">
          <Dialog.Title className="text-sm font-semibold">
            Pull sketch into solid
          </Dialog.Title>
          <Dialog.Description className="pb-3 text-xs text-white/55">
            Blind extrude along the sketch normal (one Undo step).
          </Dialog.Description>
          <label className="mb-2 block text-xs text-white/70">
            Distance (mm)
            <input
              defaultValue={distance}
              onChange={(e) => setDistance(e.target.value)}
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
              disabled={busy}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
            >
              {busy ? "Building…" : "Extrude"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
