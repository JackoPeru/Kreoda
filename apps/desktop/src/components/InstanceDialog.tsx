// Rigid instance of the selected solid (Phase 9d): translation mm +
// extrinsic ZYX degrees. The copy follows target edits through the DAG;
// no mating constraints in slice 1 (explicit placement only).
import { useMemo, useState } from "react";
import { parseAngleToDeg, parseLengthToMm } from "@kreoda/units";
import { executeCommand } from "../commands/execute";
import { useDocumentUiStore, useSelectionStore } from "../stores";
import { CadDialog } from "./CadDialog";
import { useT, featureTypeName } from "../i18n";

export function InstanceDialog({ onClose }: { onClose: () => void }) {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const features = useDocumentUiStore((s) => s.features);
  const [pos, setPos] = useState<[string, string, string]>(["20", "0", "0"]);
  const [r, setR] = useState<[string, string, string]>(["0", "0", "0"]);
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

  const submit = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      if (!target) throw new Error(tt("instance.errNoTarget"));
      const [txMm, tyMm, tzMm] = [
        parseLengthToMm(pos[0]!),
        parseLengthToMm(pos[1]!),
        parseLengthToMm(pos[2]!),
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
      setError(e instanceof Error ? e.message : tt("instance.errFailed"));
    } finally {
      setBusy(false);
    }
  };

  const setPosAt = (i: number, v: string): void =>
    setPos([pos[0], pos[1], pos[2]].map((x, j) => (j === i ? v : x)) as [
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
    <CadDialog
      title={tt("instance.title")}
      description={
        target
          ? tt("instance.descOn", { type: featureTypeName(target.type) })
          : tt("instance.descOff")
      }
      onClose={onClose}
      error={error}
      testId="instance-dialog"
      actions={
        <button
          onClick={() => void submit()}
          disabled={busy || !target}
          className="rounded-md bg-amber-500/90 px-3 py-1.5 text-sm font-medium text-black hover:bg-amber-400 disabled:opacity-50"
        >
          {busy ? tt("common.placing") : tt("instance.place")}
        </button>
      }
    >
      {([tt("instance.tx"), tt("instance.ty"), tt("instance.tz")] as const).map((label, i) => (
        <label key={label} className="mb-2 block text-xs text-white/70">
          {label}
          <input
            defaultValue={pos[i]}
            onChange={(e) => setPosAt(i, e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            className="mt-1 w-full rounded-md bg-white/5 px-2.5 py-1.5 text-sm text-white outline-none focus:bg-white/10"
          />
        </label>
      ))}
      {([tt("instance.rx"), tt("instance.ry"), tt("instance.rz")] as const).map((label, i) => (
        <label key={label} className="mb-2 block text-xs text-white/70">
          {label}
          <input
            defaultValue={r[i]}
            onChange={(e) => setRAt(i, e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            className="mt-1 w-full rounded-md bg-white/5 px-2.5 py-1.5 text-sm text-white outline-none focus:bg-white/10"
          />
        </label>
      ))}
    </CadDialog>
  );
}
