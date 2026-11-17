import { useMemo, useState } from "react";
import { executeCommand } from "../commands/execute";
import { useDocumentUiStore, useSelectionStore } from "../stores";
import { CadActions, CadDialog } from "./CadDialog";
import { featureTypeName, useT } from "../i18n";

/** Mirrored copy of the selected solid across a principal or datum plane. */
export function MirrorDialog({ onClose }: { onClose: () => void }) {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const features = useDocumentUiStore((s) => s.features);
  const datums = useDocumentUiStore((s) => s.datums);
  const [planeRef, setPlaneRef] = useState("plane:XY");
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

  const datumPlanes = useMemo(
    () => datums.filter((d) => d.kind === "DatumPlane" && d.status === "ok"),
    [datums],
  );

  const submit = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      if (!target) throw new Error(tt("mirror.errNoTarget"));
      const params = planeRef.startsWith("datum:")
        ? { targetId: target.featureId, datumId: planeRef.slice("datum:".length) }
        : {
            targetId: target.featureId,
            planeKind: planeRef.slice("plane:".length) as "XY" | "XZ" | "YZ",
          };
      await executeCommand("CreateMirror", params);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : tt("mirror.errFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CadDialog
      title={tt("mirror.title")}
      description={
        target
          ? tt("mirror.descOn", { type: featureTypeName(target.type) })
          : tt("mirror.descOff")
      }
      onClose={onClose}
      error={error}
      testId="mirror-dialog"
      actions={
        <CadActions
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          busyLabel={tt("common.building")}
          label={tt("mirror.apply")}
          disabled={!target}
        />
      }
    >
      <label className="mb-2 block text-xs text-white/70">
        {tt("mirror.plane")}
        <select
          value={planeRef}
          onChange={(e) => setPlaneRef(e.target.value)}
          data-testid="mirror-plane"
          className="mt-1 w-full rounded-md bg-white/5 px-2 py-1.5 text-sm text-white outline-none focus:bg-white/10"
        >
          <optgroup label={tt("mirror.principalGroup")}>
            <option value="plane:XY">XY (Z = 0)</option>
            <option value="plane:XZ">XZ (Y = 0)</option>
            <option value="plane:YZ">YZ (X = 0)</option>
          </optgroup>
          {datumPlanes.length > 0 && (
            <optgroup label={tt("mirror.datumGroup")}>
              {datumPlanes.map((datum) => (
                <option key={datum.featureId} value={`datum:${datum.featureId}`}>
                  {featureTypeName(datum.kind)} · {datum.featureId}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
    </CadDialog>
  );
}
