import { useEffect, useRef, useState } from "react";
import type {
  DatumDefinition,
  DatumDescriptor,
  DatumPlaneDefinition,
} from "@kreoda/protocol";
import { executeCommand } from "../../commands/execute";
import { featureTypeName, useT } from "../../i18n";
import {
  selectionKindOf,
  useDocumentUiStore,
  useSelectionStore,
} from "../../stores";

type EntityKind = "plane" | "axis" | "point";
type PlaneRef = Extract<DatumPlaneDefinition, { type: "offset" }>["base"];
type AxisRef = Extract<DatumPlaneDefinition, { type: "angle" }>["axis"];
type PointRef = Extract<DatumPlaneDefinition, { type: "threePoint" }>["first"];
type Reference = PlaneRef | AxisRef | PointRef;
type PickKind = "face" | "edge";
type SelectionMode = ReturnType<typeof useSelectionStore.getState>["mode"];

const fieldClass = "w-full rounded-md border border-white/10 bg-black/25 px-2 py-1.5 text-sm text-white outline-none focus:border-white/30";
const labelClass = "grid gap-1 text-xs text-white/65";

function kindOf(datum: DatumDescriptor): EntityKind {
  return datum.kind === "DatumPlane" ? "plane" : datum.kind === "DatumAxis" ? "axis" : "point";
}

function defaultDefinition(kind: EntityKind, operation?: string): DatumDefinition {
  if (kind === "plane") {
    switch (operation) {
      case "offset": return { type: "offset", base: { type: "principal", planeKind: "XY" }, offsetMm: 0 };
      case "mid": return { type: "mid", first: { type: "principal", planeKind: "XY" }, second: { type: "principal", planeKind: "XY" } };
      case "angle": return { type: "angle", base: { type: "principal", planeKind: "XY" }, axis: { type: "principal", axis: "Z" }, angleDeg: 0 };
      case "threePoint": return { type: "threePoint", first: { type: "coordinates", positionMm: [0, 0, 0] }, second: { type: "coordinates", positionMm: [1, 0, 0] }, third: { type: "coordinates", positionMm: [0, 1, 0] } };
      default: return { type: "principal", planeKind: "XY" };
    }
  }
  if (kind === "axis") {
    switch (operation) {
      case "planeNormal": return { type: "planeNormal", plane: { type: "principal", planeKind: "XY" } };
      case "planeIntersection": return { type: "planeIntersection", first: { type: "principal", planeKind: "XY" }, second: { type: "principal", planeKind: "YZ" } };
      default: return { type: "twoPoint", first: { type: "coordinates", positionMm: [0, 0, 0] }, second: { type: "coordinates", positionMm: [0, 0, 1] } };
    }
  }
  if (operation === "midpoint") return { type: "midpoint", first: { type: "coordinates", positionMm: [0, 0, 0] }, second: { type: "coordinates", positionMm: [1, 0, 0] } };
  return { type: "coordinates", positionMm: [0, 0, 0] };
}

function operationLabel(operation: string, t: ReturnType<typeof useT>): string {
  const key = `datum.op.${operation}` as Parameters<typeof t>[0];
  return t(key);
}

function numberValue(value: string): number {
  return value === "" ? Number.NaN : Number(value);
}

function coordinateLabel(point: string, axis: string, t: ReturnType<typeof useT>): string {
  return t("datum.coordinate", { point: t(`datum.point.${point}` as Parameters<typeof t>[0]), axis });
}

function NumberInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className={labelClass}>
      {label}
      <input
        className={fieldClass}
        type="number"
        min={min}
        max={max}
        step="any"
        value={Number.isFinite(value) ? value : ""}
        onChange={(event) => onChange(numberValue(event.target.value))}
      />
    </label>
  );
}

function CoordinateInputs({
  point,
  position,
  onChange,
  t,
}: {
  point: string;
  position: [number, number, number];
  onChange: (position: [number, number, number]) => void;
  t: ReturnType<typeof useT>;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {(["X", "Y", "Z"] as const).map((axis, index) => (
        <NumberInput
          key={axis}
          label={coordinateLabel(point, axis, t)}
          value={position[index]}
          min={-1_000_000}
          max={1_000_000}
          onChange={(value) => {
            const next = [...position] as [number, number, number];
            next[index] = value;
            onChange(next);
          }}
        />
      ))}
    </div>
  );
}

function featureLabel(featureId: string, features: ReturnType<typeof useDocumentUiStore.getState>["features"], t: ReturnType<typeof useT>): string {
  const feature = features.find((item) => item.featureId === featureId);
  return feature ? featureTypeName(feature.type) : t("datum.nativeObject");
}

function referenceLabel(
  ref: Reference,
  datums: DatumDescriptor[],
  features: ReturnType<typeof useDocumentUiStore.getState>["features"],
  t: ReturnType<typeof useT>,
): string {
  if (ref.type === "principal") return "planeKind" in ref
    ? t("datum.principalPlane", { plane: ref.planeKind })
    : t("datum.principalAxis", { axis: ref.axis });
  if (ref.type === "coordinates") return t("datum.manualCoordinates");
  if (ref.type === "datum") {
    const source = datums.find((datum) => datum.featureId === ref.featureId);
    if (!source) return `${t("datum.missingReference")} · ${ref.featureId}`;
    const key = source.kind === "DatumPlane" ? "datum.kind.plane" : source.kind === "DatumAxis" ? "datum.kind.axis" : "datum.kind.point";
    const status = source.status === "ok" ? "" : ` · ${t(`datum.status.${source.status}` as Parameters<typeof t>[0])}`;
    return `${t(key)} · ${ref.featureId}${status}`;
  }
  if (ref.type === "face") {
    const role = ref.persistentFaceId.slice(ref.persistentFaceId.indexOf(":") + 1);
    return t("datum.selectedFace", { object: featureLabel(ref.featureId, features, t), face: role });
  }
  const role = ref.persistentEdgeId.slice(ref.persistentEdgeId.indexOf(":") + 1);
  return t("datum.selectedEdge", { object: featureLabel(ref.featureId, features, t), edge: role });
}

function currentGeometryReferences(
  kind: EntityKind,
  current: Reference,
  datums: DatumDescriptor[],
  selectedIds: string[],
): Reference[] {
  let options: Reference[] = [];
  if (kind === "plane") {
    options = ["XY", "XZ", "YZ"].map((planeKind) => ({ type: "principal", planeKind } as PlaneRef));
    options.push(...datums.filter((datum) => datum.kind === "DatumPlane").map((datum) => ({ type: "datum", featureId: datum.featureId } as PlaneRef)));
    options.push(...selectedIds.filter((id) => id.includes(":") && selectionKindOf(id) === "face").map((id) => ({ type: "face", featureId: id.slice(0, id.indexOf(":")), persistentFaceId: id } as PlaneRef)));
  } else if (kind === "axis") {
    options = ["X", "Y", "Z"].map((axis) => ({ type: "principal", axis } as AxisRef));
    options.push(...datums.filter((datum) => datum.kind === "DatumAxis").map((datum) => ({ type: "datum", featureId: datum.featureId } as AxisRef)));
    options.push(...selectedIds.filter((id) => id.includes(":") && selectionKindOf(id) === "edge").map((id) => ({ type: "edge", featureId: id.slice(0, id.indexOf(":")), persistentEdgeId: id } as AxisRef)));
  } else {
    options = [{ type: "coordinates", positionMm: current.type === "coordinates" ? current.positionMm : [0, 0, 0] } as PointRef];
    options.push(...datums.filter((datum) => datum.kind === "DatumPoint").map((datum) => ({ type: "datum", featureId: datum.featureId } as PointRef)));
  }
  if (!options.some((option) => JSON.stringify(option) === JSON.stringify(current))) options.push(current);
  return options.filter((option, index) => options.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(option)) === index);
}

function walkReferences(value: unknown): Reference[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(walkReferences);
  const object = value as Record<string, unknown>;
  const type = object.type;
  if (type === "principal" || type === "datum" || type === "face" || type === "edge" || type === "coordinates") return [object as Reference];
  return Object.values(object).flatMap(walkReferences);
}

function describeReference(
  ref: Reference,
  datums: DatumDescriptor[],
  features: ReturnType<typeof useDocumentUiStore.getState>["features"],
  t: ReturnType<typeof useT>,
): string {
  if (ref.type === "coordinates") return `${t("datum.manualCoordinates")} · ${ref.positionMm.join(", ")} mm`;
  return referenceLabel(ref, datums, features, t);
}

function DatumDetails({
  datum,
  datums,
  features,
  t,
}: {
  datum: DatumDescriptor;
  datums: DatumDescriptor[];
  features: ReturnType<typeof useDocumentUiStore.getState>["features"];
  t: ReturnType<typeof useT>;
}) {
  const resolvedNames: Record<string, string> = {
    originMm: t("datum.resolved.origin"),
    positionMm: t("datum.resolved.position"),
    direction: t("datum.resolved.direction"),
    xAxis: t("datum.resolved.xAxis"),
    yAxis: t("datum.resolved.yAxis"),
    normal: t("datum.resolved.normal"),
  };
  const references = walkReferences(datum.definition);
  return (
    <details className="rounded-md border border-white/10 bg-black/15 px-2 py-1.5 text-xs">
      <summary className="cursor-pointer text-white/70">{t("datum.inspect")}</summary>
      <div className="mt-2 grid gap-2">
        <div>
          <span className="text-white/45">{t("datum.status.label")}: </span>
          <span>{t(`datum.status.${datum.status}` as Parameters<typeof t>[0])}</span>
        </div>
        {datum.error && <p className="text-red-300" role="alert">{datum.error}</p>}
        <div>
          <div className="mb-0.5 text-white/45">{t("datum.sources")}</div>
          {references.length > 0 ? references.map((ref, index) => (
            <div key={`${ref.type}-${index}`} className="break-words">{describeReference(ref, datums, features, t)}</div>
          )) : <div className="text-white/50">{t("datum.noSources")}</div>}
        </div>
        <div>
          <div className="mb-0.5 text-white/45">{t("datum.resolved")}</div>
          {Object.entries(datum.resolved ?? {}).map(([key, value]) => Array.isArray(value) && (
            <div key={key} className="break-words">
              {resolvedNames[key] ?? key}: {value.join(", ")}{key.endsWith("Mm") ? " mm" : ""}
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

export function ReferenceGeometryPanel({
  onClose,
  onSketchCreated,
}: {
  onClose: () => void;
  onSketchCreated: (featureId: string) => void;
}) {
  const t = useT();
  const datums = useDocumentUiStore((state) => state.datums);
  const features = useDocumentUiStore((state) => state.features);
  const sketches = useDocumentUiStore((state) => state.sketches);
  const selectedIds = useSelectionStore((state) => state.selectedIds);
  const selectedDatum = datums.find((datum) => selectedIds.includes(datum.featureId));
  const initialDatum = datums.find((datum) => selectedIds.includes(datum.featureId));
  const [editingId, setEditingId] = useState(initialDatum?.featureId ?? "");
  const [entityKind, setEntityKind] = useState<EntityKind>(initialDatum ? kindOf(initialDatum) : "plane");
  const [definition, setDefinition] = useState<DatumDefinition>((initialDatum?.definition as DatumDefinition | undefined) ?? defaultDefinition("plane"));
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const restorePick = useRef<{ mode: SelectionMode; selectedIds: string[]; kind: PickKind } | null>(null);
  const editingDatum = datums.find((datum) => datum.featureId === editingId);
  const inspectDatum = editingDatum ?? selectedDatum;
  const canCreateSketch = selectedDatum?.kind === "DatumPlane" && selectedDatum.status === "ok";

  const close = (): void => {
    if (restorePick.current) {
      useSelectionStore.getState().setMode(restorePick.current.mode);
      restorePick.current = null;
    }
    onClose();
  };

  useEffect(() => {
    const pending = restorePick.current;
    if (!pending) return;
    const picked = selectedIds.some((id) =>
      !pending.selectedIds.includes(id) && id.includes(":") && selectionKindOf(id) === pending.kind,
    );
    if (picked) {
      useSelectionStore.getState().setMode(pending.mode);
      restorePick.current = null;
    }
  }, [selectedIds]);

  const setRef = (field: string, ref: Reference): void => {
    setDefinition((current) => ({ ...current, [field]: ref } as DatumDefinition));
    setError(null);
  };

  const updatePoint = (field: string, positionMm: [number, number, number]): void => {
    setDefinition((current) => {
      if (current.type === "coordinates") return { ...current, positionMm };
      const currentRef = (current as unknown as Record<string, Reference>)[field];
      if (currentRef?.type !== "coordinates") return current;
      return { ...current, [field]: { ...currentRef, positionMm } } as DatumDefinition;
    });
    setError(null);
  };

  const beginPick = (kind: PickKind): void => {
    const selection = useSelectionStore.getState();
    restorePick.current = { mode: selection.mode, selectedIds: [...selection.selectedIds], kind };
    selection.setMode(kind);
  };

  const setKind = (kind: EntityKind): void => {
    setEntityKind(kind);
    setDefinition(defaultDefinition(kind));
    setError(null);
    setMessage(null);
  };

  const setOperation = (operation: string): void => {
    setDefinition(defaultDefinition(entityKind, operation));
    setError(null);
    setMessage(null);
  };

  const chooseExisting = (featureId: string): void => {
    setEditingId(featureId);
    setError(null);
    setMessage(null);
    if (!featureId) {
      setKind("plane");
      return;
    }
    const datum = datums.find((item) => item.featureId === featureId);
    if (datum) {
      setEntityKind(kindOf(datum));
      setDefinition(datum.definition as DatumDefinition);
    }
  };

  const submit = async (): Promise<void> => {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      if (editingId) await executeCommand("UpdateDatum", { featureId: editingId, definition });
      else await executeCommand(entityKind === "plane" ? "CreateDatumPlane" : entityKind === "axis" ? "CreateDatumAxis" : "CreateDatumPoint", { definition });
      setMessage(t(editingId ? "datum.updated" : "datum.created"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("datum.failed"));
    } finally {
      setBusy(false);
    }
  };

  const createSketch = async (): Promise<void> => {
    if (!canCreateSketch || !selectedDatum) return;
    setError(null);
    setBusy(true);
    try {
      const existing = new Set(sketches.map((sketch) => sketch.featureId));
      await executeCommand("CreateSketch", { supportRef: selectedDatum.featureId, model: {} });
      const created = useDocumentUiStore.getState().sketches.find((sketch) => !existing.has(sketch.featureId));
      if (created) {
        close();
        onSketchCreated(created.featureId);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("datum.failed"));
    } finally {
      setBusy(false);
    }
  };

  const pointField = (field: string, label: string, ref: PointRef) => (
    <>
      <SourceSelect
        label={label}
        kind="point"
        current={ref}
        datums={datums}
        features={features}
        selectedIds={selectedIds}
        t={t}
        onChange={(next) => setRef(field, next)}
      />
      {ref.type === "coordinates" && (
        <CoordinateInputs
          point={field}
          position={ref.positionMm}
          onChange={(position) => updatePoint(field, position)}
          t={t}
        />
      )}
    </>
  );

  const planeField = (field: string, label: string, ref: PlaneRef) => (
    <SourceSelect label={label} kind="plane" current={ref} datums={datums} features={features} selectedIds={selectedIds} t={t} onChange={(next) => setRef(field, next)} onPick={() => beginPick("face")} />
  );

  const axisField = (field: string, label: string, ref: AxisRef) => (
    <SourceSelect label={label} kind="axis" current={ref} datums={datums} features={features} selectedIds={selectedIds} t={t} onChange={(next) => setRef(field, next)} onPick={() => beginPick("edge")} />
  );

  const operations = entityKind === "plane"
    ? ["principal", "offset", "mid", "angle", "threePoint"]
    : entityKind === "axis"
      ? ["twoPoint", "planeNormal", "planeIntersection"]
      : ["coordinates", "midpoint"];

  return (
    <section
      className="kreoda-float-elevated fixed right-3 top-[68px] z-40 flex max-h-[70vh] w-[320px] max-w-[calc(100vw-24px)] flex-col overflow-hidden p-2"
      aria-label={t("datum.title")}
      data-testid="reference-geometry-panel"
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.stopPropagation(); close(); }
      }}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 px-2 py-1">
        <h2 className="text-sm font-medium text-white/90">{t("datum.title")}</h2>
        <button type="button" onClick={close} aria-label={t("datum.close")} className="rounded px-1.5 py-0.5 text-white/50 hover:bg-white/10 hover:text-white">✕</button>
      </header>
      <div className="min-h-0 space-y-3 overflow-y-auto px-2 pb-2 pt-1">
        {selectedDatum?.kind === "DatumPlane" && (
          <button type="button" disabled={!canCreateSketch || busy} onClick={() => void createSketch()} className="w-full rounded-md bg-[var(--kreoda-accent)] px-2.5 py-1.5 text-sm text-white hover:bg-[var(--kreoda-accent-hover)] disabled:cursor-not-allowed disabled:opacity-40">
            {t("datum.createSketch")}
          </button>
        )}
        <label className={labelClass}>
          {t("datum.editExisting")}
          <select className={fieldClass} value={editingId} onChange={(event) => chooseExisting(event.target.value)}>
            <option value="">{t("datum.newReference")}</option>
            {datums.map((datum) => (
              <option key={datum.featureId} value={datum.featureId}>
                {t(kindOf(datum) === "plane" ? "datum.kind.plane" : kindOf(datum) === "axis" ? "datum.kind.axis" : "datum.kind.point")} · {datum.featureId}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          {t("datum.referenceType")}
          <select className={fieldClass} value={entityKind} disabled={Boolean(editingId)} onChange={(event) => setKind(event.target.value as EntityKind)}>
            {(["plane", "axis", "point"] as const).map((kind) => <option key={kind} value={kind}>{t(`datum.kind.${kind}` as Parameters<typeof t>[0])}</option>)}
          </select>
        </label>
        <label className={labelClass}>
          {t("datum.construction")}
          <select className={fieldClass} value={definition.type} onChange={(event) => setOperation(event.target.value)}>
            {operations.map((operation) => <option key={operation} value={operation}>{operationLabel(operation, t)}</option>)}
          </select>
        </label>

        {entityKind === "plane" && definition.type === "principal" && (
          <label className={labelClass}>
            {t("datum.principalPlaneLabel")}
            <select className={fieldClass} aria-label={t("datum.principalPlaneLabel")} value={definition.planeKind} onChange={(event) => setDefinition({ ...definition, planeKind: event.target.value as "XY" | "XZ" | "YZ" })}>
              {(["XY", "XZ", "YZ"] as const).map((plane) => <option key={plane} value={plane}>{t("datum.principalPlane", { plane })}</option>)}
            </select>
          </label>
        )}
        {entityKind === "plane" && definition.type === "offset" && <>
          {planeField("base", t("datum.basePlane"), definition.base)}
          <NumberInput label={t("datum.offset") } value={definition.offsetMm} min={-1_000_000} max={1_000_000} onChange={(offsetMm) => setDefinition({ ...definition, offsetMm })} />
        </>}
        {entityKind === "plane" && definition.type === "mid" && <>
          {planeField("first", t("datum.firstPlane"), definition.first)}
          {planeField("second", t("datum.secondPlane"), definition.second)}
        </>}
        {entityKind === "plane" && definition.type === "angle" && <>
          {planeField("base", t("datum.basePlane"), definition.base)}
          {axisField("axis", t("datum.rotationAxis"), definition.axis)}
          <NumberInput label={t("datum.angle") } value={definition.angleDeg} min={-360} max={360} onChange={(angleDeg) => setDefinition({ ...definition, angleDeg })} />
        </>}
        {entityKind === "plane" && definition.type === "threePoint" && <>
          {pointField("first", t("datum.firstPoint"), definition.first)}
          {pointField("second", t("datum.secondPoint"), definition.second)}
          {pointField("third", t("datum.thirdPoint"), definition.third)}
        </>}

        {entityKind === "axis" && definition.type === "twoPoint" && <>
          {pointField("first", t("datum.firstPoint"), definition.first)}
          {pointField("second", t("datum.secondPoint"), definition.second)}
        </>}
        {entityKind === "axis" && definition.type === "planeNormal" && <>
          {planeField("plane", t("datum.supportPlane"), definition.plane)}
          <label className="flex items-center gap-2 text-xs text-white/65">
            <input type="checkbox" checked={Boolean(definition.through)} onChange={(event) => setDefinition(event.target.checked ? { ...definition, through: { type: "coordinates", positionMm: [0, 0, 0] } } : { type: "planeNormal", plane: definition.plane })} />
            {t("datum.setThroughPoint")}
          </label>
          {definition.through && pointField("through", t("datum.throughPoint"), definition.through)}
        </>}
        {entityKind === "axis" && definition.type === "planeIntersection" && <>
          {planeField("first", t("datum.firstPlane"), definition.first)}
          {planeField("second", t("datum.secondPlane"), definition.second)}
        </>}

        {entityKind === "point" && definition.type === "coordinates" && (
          <CoordinateInputs point="point" position={definition.positionMm} onChange={(positionMm) => setDefinition({ ...definition, positionMm })} t={t} />
        )}
        {entityKind === "point" && definition.type === "midpoint" && <>
          {pointField("first", t("datum.firstPoint"), definition.first)}
          {pointField("second", t("datum.secondPoint"), definition.second)}
        </>}

        {inspectDatum && <DatumDetails datum={inspectDatum} datums={datums} features={features} t={t} />}
        {error && <p role="alert" className="break-words text-xs text-red-300">{error}</p>}
        {message && <p role="status" className="text-xs text-emerald-300">{message}</p>}
        <button type="button" disabled={busy} onClick={() => void submit()} className="w-full rounded-md bg-white/10 px-2.5 py-1.5 text-sm text-white/90 hover:bg-white/15 disabled:opacity-40">
          {busy ? t("common.running") : t(editingId ? "datum.update" : "datum.create")}
        </button>
      </div>
    </section>
  );
}

function SourceSelect({
  label,
  kind,
  current,
  datums,
  features,
  selectedIds,
  t,
  onChange,
  onPick,
}: {
  label: string;
  kind: EntityKind;
  current: Reference;
  datums: DatumDescriptor[];
  features: ReturnType<typeof useDocumentUiStore.getState>["features"];
  selectedIds: string[];
  t: ReturnType<typeof useT>;
  onChange: (ref: Reference) => void;
  onPick?: () => void;
}) {
  const options = currentGeometryReferences(kind, current, datums, selectedIds);
  const pickLabel = kind === "plane" ? t("datum.selectFace") : t("datum.selectEdge");
  return (
    <div className="grid gap-1.5">
      <label className={labelClass}>
        {label}
        <select className={fieldClass} value={JSON.stringify(current)} onChange={(event) => onChange(JSON.parse(event.target.value) as Reference)}>
          {options.map((ref) => <option key={JSON.stringify(ref)} value={JSON.stringify(ref)}>{referenceLabel(ref, datums, features, t)}</option>)}
        </select>
      </label>
      {onPick && <div className="flex items-center gap-2">
        <button type="button" onClick={onPick} className="rounded border border-white/10 px-2 py-1 text-xs text-white/70 hover:bg-white/10">{pickLabel}</button>
        <span className="text-[11px] text-white/40">{t("datum.pickHint")}</span>
      </div>}
    </div>
  );
}
