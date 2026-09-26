import { useState } from "react";
import { parseLengthToMm } from "@kreoda/units";
import { executeCommand } from "../commands/execute";
import { CadActions, CadDialog } from "./CadDialog";
import { t, useT, type EnKey } from "../i18n";

export type PrimitiveKind = "box" | "cylinder" | "sphere";

const TITLE_KEY: Record<PrimitiveKind, EnKey> = {
  box: "add.boxTitle",
  cylinder: "add.cylinderTitle",
  sphere: "add.sphereTitle",
};

const DEFAULT_FIELDS: Record<PrimitiveKind, [string, string][]> = {
  box: [["widthMm", "100"], ["heightMm", "50"], ["depthMm", "20"]],
  cylinder: [["radiusMm", "20"], ["heightMm", "60"]],
  sphere: [["radiusMm", "25"]],
};

const FIELD_KEY: Record<string, EnKey> = {
  widthMm: "add.fieldWidth",
  heightMm: "add.fieldHeight",
  depthMm: "add.fieldDepth",
  radiusMm: "add.fieldRadius",
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
  const tt = useT();

  if (!kind) return null;
  const fields = DEFAULT_FIELDS[kind];
  const commandId =
    kind === "box" ? "CreateBox" : kind === "cylinder" ? "CreateCylinder" : "CreateSphere";

  const submit = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const mm: Record<string, number> = {};
      for (const [name, dflt] of fields) {
        // Dimension text doubles as direct editing affordance (§22).
        mm[name] = parseLengthToMm(values[name] ?? dflt);
        if (!(mm[name]! > 0)) throw new Error(tt("add.errPositive", { label: tt(FIELD_KEY[name]!) }));
      }
      // Single chokepoint: zod validation + typed core execution (§19).
      await executeCommand(commandId, mm);
      onClose();
    } catch (e) {
      // Actionable errors (§41): surface the kernel message, never fake it.
      setError(e instanceof Error ? e.message : t("add.errCreateFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CadDialog
      title={tt(TITLE_KEY[kind])}
      description={tt("add.desc")}
      onClose={onClose}
      error={error}
      actions={
        <CadActions
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          busyLabel={tt("common.building")}
          label={tt("common.create")}
        />
      }
    >
      {fields.map(([name, dflt]) => (
        <label key={name} className="mb-2 block text-xs text-white/70">
          {tt(FIELD_KEY[name]!)} {tt("common.unitMm")}
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
