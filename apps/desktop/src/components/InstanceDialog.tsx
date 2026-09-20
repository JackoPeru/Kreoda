// Rigid instance of the selected solid (Phase 9d): translation mm +
// extrinsic ZYX degrees. The copy follows target edits through the DAG;
// no mating constraints in slice 1 (explicit placement only).
import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { parseAngleToDeg, parseLengthToMm } from "@kreoda/units";
import { executeCommand } from "../commands/execute";
import { useDocumentUiStore, useSelectionStore } from "../stores";

export function InstanceDialog({ onClose }: { onClose: () => void }) {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const features = useDocumentUiStore((s) => s.features);
  const [t, setT] = useState<[string, string, string]>(["20", "0", "0"]);
  const [r, setR] = useState<[string, string, string]>(["0", "0", "0"]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const target = useMemo(() => {
    const bare = selectedIds.find((id) => !id.includes(":"));
    if (!bare) return null;
    const feature = features.find((f) => f.featureId === bare);
    if (!feature) return null;
    return { featureId: bare, type: feature.type };
  }, [selectedIds, features]);

  const submit = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      if (!target) throw new Error("Select a solid body first");
      const [txMm, tyMm, tzMm] = [
        parseLengthToMm(t[0]!),
        parseLengthToMm(t[1]!),
        parseLengthToMm(t[2]!),
      ] as [number, number, number];
      const [rxDeg, ryDeg, rzDeg] = [
        parseAngleToDeg(r[0]!),
        parseAngleToDeg(r[1]!),
        parseAngleToDeg(r[2]!),
      ] as [number, number, number];
      await executeCommand("CreateInstance", {
        targetId: target.featureId,
        txMm,
        tyMm,
        tzMm,
        rxDeg,
        ryDeg,
        rzDeg,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "instance failed");
    } finally {
      setBusy(false);
    }
  };

  const setTAt = (i: number, v: string): void =>
    setT([t[0], t[1], t[2]].map((x, j) => (j === i ? v : x)) as [
      string,
      string,
      string,
    ]);
  const setRAt = (i: number, v: string): void =>
    setR([r[0], r[1], r[2]].map((x, j) => (j === i ? v : x)) as [
      string,
      string,
      string,
    ]);

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content
          className="fixed left-1/2 top-1/3 w-80 -translate-x-1/2 rounded-lg border border-white/15 bg-[#141922] p-4"
          data-testid="instance-dialog"
        >
          <Dialog.Title className="text-sm font-semibold">
            Place instance
          </Dialog.Title>
          <Dialog.Description className="pb-3 text-xs text-white/55">
            {target
              ? `Copy of ${target.type} — follows its edits. No mating yet.`
              : "Select a solid body first."}
          </Dialog.Description>
          {(["X", "Y", "Z"] as const).map((axis, i) => (
            <label key={axis} className="mb-2 block text-xs text-white/70">
              Translate {axis} (mm)
              <input
                defaultValue={t[i]}
                onChange={(e) => setTAt(i, e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void submit()}
                className="mt-1 w-full rounded-md bg-white/5 px-2.5 py-1.5 text-sm text-white outline-none focus:bg-white/10"
              />
            </label>
          ))}
          {(["X", "Y", "Z"] as const).map((axis, i) => (
            <label key={axis} className="mb-2 block text-xs text-white/70">
              Rotate {axis} (°)
              <input
                defaultValue={r[i]}
                onChange={(e) => setRAt(i, e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void submit()}
                className="mt-1 w-full rounded-md bg-white/5 px-2.5 py-1.5 text-sm text-white outline-none focus:bg-white/10"
              />
            </label>
          ))}
          {error && <div className="pb-2 text-xs text-red-300">{error}</div>}
          <button
            onClick={() => void submit()}
            disabled={busy || !target}
            className="rounded-md bg-amber-500/90 px-3 py-1.5 text-sm font-medium text-black hover:bg-amber-400 disabled:opacity-50"
          >
            {busy ? "Placing…" : "Place instance"}
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
