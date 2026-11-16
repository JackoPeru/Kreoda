import { useMemo, useState } from "react";
import { executeCommand } from "../commands/execute";
import { useDocumentUiStore, useSelectionStore } from "../stores";
import { CadActions, CadDialog } from "./CadDialog";
import { featureTypeName, useT } from "../i18n";

/** Mirrored copy of the selected solid across a principal plane at the origin. */
export function MirrorDialog({ onClose }: { onClose: () => void }) {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const features = useDocumentUiStore((s) => s.features);
  const [plane, setPlane] = useState<"XY" | "XZ" | "YZ">("XY");
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
      if (!target) throw new Error(tt("mirror.errNoTarget"));
      await executeCommand("CreateMirror", {
        targetId: target.featureId,
        planeKind: plane,
      });
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
          value={plane}
          onChange={(e) => setPlane(e.target.value as "XY" | "XZ" | "YZ")}
          data-testid="mirror-plane"
          className="mt-1 w-full rounded-md bg-white/5 px-2 py-1.5 text-sm text-white outline-none focus:bg-white/10"
        >
          <option value="XY">XY (Z = 0)</option>
          <option value="XZ">XZ (Y = 0)</option>
          <option value="YZ">YZ (X = 0)</option>
        </select>
      </label>
    </CadDialog>
  );
}
