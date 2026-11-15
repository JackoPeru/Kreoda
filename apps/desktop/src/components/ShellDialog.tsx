import { useState } from "react";
import { parseLengthToMm } from "@kreoda/units";
import { executeCommand } from "../commands/execute";
import { isSketchId, selectionKindOf, useSelectionStore } from "../stores";
import { CadActions, CadDialog } from "./CadDialog";
import { t, useT } from "../i18n";

/** Hollow the selected solid, leaving one face open (wall thickness). */
export function ShellDialog({ onClose }: { onClose: () => void }) {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const [value, setValue] = useState("2");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tt = useT();

  const faceIds = selectedIds.filter(
    (id) => selectionKindOf(id) === "face" && !isSketchId(id),
  );
  const targetId =
    faceIds.length > 0 ? faceIds[0]!.slice(0, faceIds[0]!.indexOf(":")) : null;
  const mixed =
    faceIds.length > 0 &&
    faceIds.some((id) => id.slice(0, id.indexOf(":")) !== targetId);

  const submit = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      if (!targetId || mixed || faceIds.length !== 1) {
        throw new Error(tt("shell.errOneFace"));
      }
      const v = parseLengthToMm(value);
      await executeCommand("CreateShell", {
        targetId,
        faceRole: faceIds[0]!,
        thicknessMm: v,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("shell.errFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CadDialog
      title={tt("shell.title")}
      description={
        faceIds.length === 0
          ? tt("shell.descOff")
          : faceIds.length === 1
            ? tt("shell.descOne")
            : tt("shell.descMany", { n: faceIds.length })
      }
      onClose={onClose}
      error={error}
      actions={
        <CadActions
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          busyLabel={tt("common.building")}
          label={tt("shell.apply")}
          disabled={faceIds.length !== 1 || mixed}
        />
      }
    >
      <label className="mb-2 block text-xs text-white/70">
        {tt("shell.thickness")}
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
