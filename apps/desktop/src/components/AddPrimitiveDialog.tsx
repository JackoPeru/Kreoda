import { useState } from "react";
import { parseLengthToMm } from "@kreoda/units";
import { executeCommand } from "../commands/execute";
import { CadActions, CadDialog } from "./CadDialog";

export type PrimitiveKind = "box" | "cylinder" | "sphere";

const DEFAULTS: Record<PrimitiveKind, { label: string; fields: [string, string][] }> = {
  box: { label: "Add box", fields: [["widthMm", "100"], ["heightMm", "50"], ["depthMm", "20"]] },
  cylinder: { label: "Add tube", fields: [["radiusMm", "20"], ["heightMm", "60"]] },
  sphere: { label: "Add ball", fields: [["radiusMm", "25"]] },
};

const FIELD_LABEL: Record<string, string> = {
  widthMm: "Width",
  heightMm: "Height",
  depthMm: "Depth",
  radiusMm: "Radius",
};

/** Exact-size primitive creation (§62 Scenario A): type numbers, get OCCT B-Rep. */
export function AddPrimitiveDialog({
  kind,
  onClose,
}: {
  kind: PrimitiveKind | null;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!kind) return null;
  const def = DEFAULTS[kind];
  const commandId =
    kind === "box" ? "CreateBox" : kind === "cylinder" ? "CreateCylinder" : "CreateSphere";

  const submit = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const mm: Record<string, number> = {};
      for (const [name, dflt] of def.fields) {
        // Dimension text doubles as direct editing affordance (§22).
        mm[name] = parseLengthToMm(values[name] ?? dflt);
        if (!(mm[name]! > 0)) throw new Error(`${FIELD_LABEL[name]} must be positive`);
      }
      // Single chokepoint: zod validation + typed core execution (§19).
      await executeCommand(commandId, mm);
      onClose();
    } catch (e) {
      // Actionable errors (§41): surface the kernel message, never fake it.
      setError(e instanceof Error ? e.message : "creation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <CadDialog
      title={def.label}
      description="Exact size in mm — built as a real B-Rep solid."
      onClose={onClose}
      error={error}
      actions={
        <CadActions
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          busyLabel="Building…"
          label="Create"
        />
      }
    >
      {def.fields.map(([name, dflt]) => (
        <label key={name} className="mb-2 block text-xs text-white/70">
          {FIELD_LABEL[name]} (mm)
          <input
            defaultValue={values[name] ?? dflt}
            onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            className="mt-1 w-full rounded-md bg-white/5 px-2.5 py-1.5 text-sm text-white outline-none focus:bg-white/10"
          />
        </label>
      ))}
    </CadDialog>
  );
}
