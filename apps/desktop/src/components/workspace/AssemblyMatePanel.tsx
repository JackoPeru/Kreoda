import { useEffect, useRef, useState } from "react";
import { parseAngleToDeg, parseLengthToMm } from "@kreoda/units";
import { coreClient, type AssemblyConstraintRequest, type AssemblyGeometryCapture, type AssemblyMateContext } from "../../ipc/coreClient";
import { syncFromCoreList } from "../../model/sync";
import { selectionKindOf, useDocumentUiStore, useSelectionStore } from "../../stores";

type MateKind = AssemblyConstraintRequest["kind"];
type CaptureSlot = "moving" | "fixed";

function geometryName(capture: AssemblyGeometryCapture): string {
  return capture.sourceBinding.geometryKind === "plane" ? "piano" :
    capture.sourceBinding.geometryKind === "circle" ? "cerchio" :
    capture.sourceBinding.geometryKind === "cylinder" ? "cilindro" : "retta";
}

function instanceName(featureId: string, index: number, type: string): string {
  const displayType = type === "Box" ? "Box" : type === "Cylinder" ? "Cylinder" :
    type === "Sphere" ? "Sfera" : type === "StepImport" ? "Importazione" : "Istanza";
  return `Istanza ${index + 1} · ${displayType}`;
}

function contextCurrent(context: AssemblyMateContext, revisions: readonly number[], requireMesh: boolean): boolean {
  const current = useDocumentUiStore.getState();
  return current.coreRunning && current.documentId === context.documentId && current.epoch === context.epoch &&
    current.connectionGeneration === context.connectionGeneration && revisions.includes(current.revision) &&
    (!requireMesh || current.meshRevision === context.meshRevision);
}

export function AssemblyMatePanel() {
  const features = useDocumentUiStore(s => s.features);
  const revision = useDocumentUiStore(s => s.revision);
  const epoch = useDocumentUiStore(s => s.epoch);
  const documentId = useDocumentUiStore(s => s.documentId);
  const connectionGeneration = useDocumentUiStore(s => s.connectionGeneration);
  const meshRevision = useDocumentUiStore(s => s.meshRevision);
  const selectedIds = useSelectionStore(s => s.selectedIds);
  const instances = features.filter(f => f.type === "Instance");
  const [kind, setKind] = useState<MateKind>("ground");
  const [movingId, setMovingId] = useState("");
  const [fixedId, setFixedId] = useState("");
  const [axis, setAxis] = useState<0 | 1 | 2>(0);
  const [distance, setDistance] = useState("0 mm");
  const [angle, setAngle] = useState("0°");
  const [movingCapture, setMovingCapture] = useState<AssemblyGeometryCapture | null>(null);
  const [fixedCapture, setFixedCapture] = useState<AssemblyGeometryCapture | null>(null);
  const [busyCount, setBusyCount] = useState(0);
  const [error, setError] = useState("");
  const captureSequence = useRef({ moving: 0, fixed: 0 });
  const operationSequence = useRef(0);
  const activeOperations = useRef(0);
  const instancesKey = instances.map(f => `${f.featureId}:${f.type}`).join("|");

  useEffect(() => {
    captureSequence.current.moving++;
    captureSequence.current.fixed++;
    setMovingCapture(null);
    setFixedCapture(null);
  }, [documentId, revision, epoch, connectionGeneration, meshRevision]);

  useEffect(() => {
    operationSequence.current++;
    setError("");
  }, [documentId, epoch, connectionGeneration]);

  useEffect(() => {
    if (!instances.some(f => f.featureId === movingId)) setMovingId("");
    if (!instances.some(f => f.featureId === fixedId) || fixedId === movingId) setFixedId("");
    setMovingCapture(null);
    setFixedCapture(null);
    captureSequence.current.moving++;
    captureSequence.current.fixed++;
  }, [instancesKey]);

  const geometryMate = ["parallel", "perpendicular", "concentric", "angle"].includes(kind);
  let parsedDistance: number | undefined;
  let parsedAngle: number | undefined;
  let numberError = "";
  if (kind === "distance") {
    try {
      if (!distance.trim()) throw new Error();
      parsedDistance = parseLengthToMm(distance);
      if (!Number.isFinite(parsedDistance)) throw new Error();
    } catch { numberError = "Inserisci una distanza valida e finita."; }
  } else if (kind === "angle") {
    try {
      if (!angle.trim()) throw new Error();
      parsedAngle = parseAngleToDeg(angle.replace(/\s*°\s*$/, " deg"));
      if (!Number.isFinite(parsedAngle) || parsedAngle < 0 || parsedAngle > 180) throw new Error();
    } catch { numberError = "Inserisci un angolo finito tra 0° e 180°."; }
  }

  const needsFixed = kind !== "ground";
  const validInstances = instances.some(f => f.featureId === movingId) &&
    (!needsFixed || (fixedId !== movingId && instances.some(f => f.featureId === fixedId)));
  const capturesCurrent = !geometryMate || (!!movingCapture && !!fixedCapture &&
    movingCapture.captureRevision === revision && fixedCapture.captureRevision === revision);
  const concentricError = kind === "concentric" && movingCapture && fixedCapture &&
    !["circle", "cylinder"].includes(movingCapture.sourceBinding.geometryKind) ||
    kind === "concentric" && movingCapture && fixedCapture &&
    !["circle", "cylinder"].includes(fixedCapture.sourceBinding.geometryKind)
      ? "Per il concentrico acquisisci due facce cilindriche o bordi circolari." : "";
  const valid = validInstances && capturesCurrent && !numberError && !concentricError && busyCount === 0;

  const capture = async (slot: CaptureSlot) => {
    const instanceId = slot === "moving" ? movingId : fixedId;
    const liveSelection = useSelectionStore.getState().selectedIds;
    const pickId = liveSelection.length === 1 ? liveSelection[0]! : "";
    const sequence = ++captureSequence.current[slot];
    if (slot === "moving") setMovingCapture(null); else setFixedCapture(null);
    const stillLatest = () => captureSequence.current[slot] === sequence;
    setError("");
    if (!instanceId || !pickId || !pickId.startsWith(`${instanceId}:`) ||
        !["face", "edge"].includes(selectionKindOf(pickId))) {
      setError("Seleziona una faccia o un bordo dell’istanza scelta nel viewport.");
      return;
    }
    activeOperations.current++;
    setBusyCount(activeOperations.current);
    try {
      const context = await coreClient.captureAssemblyMateContext();
      if (!contextCurrent(context, [context.revision], true) || useSelectionStore.getState().selectedIds.length !== 1 ||
          useSelectionStore.getState().selectedIds[0] !== pickId)
        throw new Error("Selezione o documento cambiati; riprova.");
      const result = await coreClient.captureAssemblyGeometrySelection(instanceId, pickId, context);
      if (!stillLatest() || !contextCurrent(context, [context.revision], true) ||
          useSelectionStore.getState().selectedIds.length !== 1 || useSelectionStore.getState().selectedIds[0] !== pickId)
        throw new Error("Cattura geometria scaduta; riprova.");
      if (slot === "moving") setMovingCapture(result); else setFixedCapture(result);
    } catch (cause) {
      if (stillLatest()) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      activeOperations.current = Math.max(0, activeOperations.current - 1);
      setBusyCount(activeOperations.current);
    }
  };

  const apply = async () => {
    if (!valid) return;
    const token = ++operationSequence.current;
    setError("");
    activeOperations.current++;
    setBusyCount(activeOperations.current);
    try {
      const context = await coreClient.captureAssemblyMateContext();
      if (!contextCurrent(context, [context.revision], false) ||
          (geometryMate && (!movingCapture || !fixedCapture || movingCapture.captureRevision !== context.revision ||
            fixedCapture.captureRevision !== context.revision)))
        throw new Error("Documento o geometria cambiati; acquisisci di nuovo i riferimenti.");
      const nextRevision = context.revision + 1;
      const currentApply = () => token === operationSequence.current &&
        contextCurrent(context, [context.revision, nextRevision], false);
      const constraintId = `mate-${crypto.randomUUID()}`;
      let request: AssemblyConstraintRequest;
      if (kind === "ground") request = { constraintId, kind, movingId };
      else if (kind === "coincident") request = { constraintId, kind, movingId, fixedId };
      else if (kind === "distance") request = { constraintId, kind, movingId, fixedId, axis, distanceMm: parsedDistance! };
      else {
        const common = { constraintId, movingId, fixedId,
          captureRevision: context.revision, movingPickId: movingCapture!.persistentId,
          fixedPickId: fixedCapture!.persistentId, movingSourceBinding: movingCapture!.sourceBinding,
          fixedSourceBinding: fixedCapture!.sourceBinding };
        request = kind === "angle" ? { ...common, kind, angleDeg: parsedAngle! } : { ...common, kind };
      }
      const result = await coreClient.defineAssemblyConstraint(request, context);
      if (result.revision !== nextRevision || !currentApply())
        throw new Error("Risposta accoppiamento scaduta.");
      const snapshot = await coreClient.requestSnapshot();
      const live = await window.kreoda.sessionSnapshot() as { sessionId?: unknown; documentId?: unknown; revision?: unknown };
      if (!currentApply() ||
          live.sessionId !== context.sessionId || live.documentId !== context.documentId || live.revision !== result.revision ||
          snapshot.revision !== result.revision)
        throw new Error("Documento cambiato durante l’aggiornamento.");
      await syncFromCoreList(snapshot.features, snapshot.revision, snapshot.sketches, null, snapshot.datums, currentApply);
      setMovingCapture(null);
      setFixedCapture(null);
    } catch (cause) {
      if (token === operationSequence.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      activeOperations.current = Math.max(0, activeOperations.current - 1);
      setBusyCount(activeOperations.current);
    }
  };

  if (instances.length === 0) return null;
  const friendly = (id: string) => {
    const index = instances.findIndex(item => item.featureId === id);
    return index < 0 ? "" : instanceName(id, index, instances[index]!.dependsOn
      .map(source => features.find(feature => feature.featureId === source)?.type ?? "")[0] ?? "");
  };
  const currentPick = selectedIds.length === 1 ? selectedIds[0]! : "";
  return <section data-testid="assembly-mate-panel" className="mt-3 border-t border-white/10 p-3 pb-24 text-xs text-white/70">
    <h3 className="font-semibold text-white">Vincoli assemblaggio</h3>
    <p className="mt-1 text-white/45">Seleziona facce o bordi nel viewport per accoppiamenti geometrici.</p>
    <select aria-label="Tipo vincolo" className="mt-2 w-full rounded bg-slate-800 p-1" value={kind}
      onChange={e => { setKind(e.target.value as MateKind); setError(""); }}>
      <option value="ground">Fissa istanza</option>
      <option value="coincident">Origini coincidenti</option>
      <option value="distance">Distanza fra origini</option>
      <option value="parallel">Facce o assi paralleli</option>
      <option value="perpendicular">Facce o assi perpendicolari</option>
      <option value="concentric">Concentrico</option>
      <option value="angle">Angolo</option>
    </select>
    <select aria-label="Istanza da vincolare" className="mt-2 w-full rounded bg-slate-800 p-1" value={movingId}
      onChange={e => { captureSequence.current.moving++; setMovingId(e.target.value); setMovingCapture(null); setError(""); }}>
      <option value="">Seleziona istanza</option>
      {instances.map((f, index) => <option key={f.featureId} value={f.featureId}>{instanceName(f.featureId, index,
        features.find(source => f.dependsOn.includes(source.featureId))?.type ?? "")}</option>)}
    </select>
    {needsFixed && <select aria-label="Istanza fissata" className="mt-2 w-full rounded bg-slate-800 p-1" value={fixedId}
      onChange={e => { captureSequence.current.fixed++; setFixedId(e.target.value); setFixedCapture(null); setError(""); }}>
      <option value="">Seleziona istanza fissa</option>
      {instances.filter(f => f.featureId !== movingId).map((f, index) => <option key={f.featureId} value={f.featureId}>
        {friendly(f.featureId) || instanceName(f.featureId, index, "")}</option>)}
    </select>}
    {kind === "distance" && <div className="mt-2 flex gap-2">
      <select aria-label="Asse distanza" value={axis} onChange={e => setAxis(Number(e.target.value) as 0 | 1 | 2)} className="w-1/3 rounded bg-slate-800 p-1">
        <option value={0}>X</option><option value={1}>Y</option><option value={2}>Z</option>
      </select>
      <input aria-label="Distanza mm" value={distance} onChange={e => setDistance(e.target.value)} className="w-2/3 rounded bg-slate-800 p-1" />
    </div>}
    {kind === "angle" && <input aria-label="Angolo gradi" value={angle} onChange={e => setAngle(e.target.value)}
      className="mt-2 w-full rounded bg-slate-800 p-1" />}
    {geometryMate && <div className="mt-2 grid grid-cols-2 gap-2">
      <div>
        <button aria-label="Acquisisci geometria mobile" disabled={!movingId}
          onClick={() => void capture("moving")} className="w-full rounded bg-slate-700 px-2 py-1 disabled:opacity-40">
          Acquisisci geometria mobile</button>
        <p className="mt-1 text-white/45">{movingCapture ? `Mobile: ${geometryName(movingCapture)}` :
          currentPick.startsWith(`${movingId}:`) ? "Selezione pronta" : "Seleziona faccia o bordo"}</p>
      </div>
      <div>
        <button aria-label="Acquisisci geometria fissa" disabled={!fixedId}
          onClick={() => void capture("fixed")} className="w-full rounded bg-slate-700 px-2 py-1 disabled:opacity-40">
          Acquisisci geometria fissa</button>
        <p className="mt-1 text-white/45">{fixedCapture ? `Fissa: ${geometryName(fixedCapture)}` :
          currentPick.startsWith(`${fixedId}:`) ? "Selezione pronta" : "Seleziona faccia o bordo"}</p>
      </div>
    </div>}
    {numberError && <p role="alert" className="mt-2 text-red-300">{numberError}</p>}
    {concentricError && <p role="alert" className="mt-2 text-red-300">{concentricError}</p>}
    <button disabled={!valid} onClick={() => void apply()} className="mt-2 rounded bg-slate-700 px-2 py-1 disabled:opacity-40">
      Crea accoppiamento</button>
    {busyCount > 0 && <p role="status">Accoppiamento in elaborazione…</p>}
    {error && !numberError && <p role="alert" className="mt-2 text-red-300">{error}</p>}
  </section>;
}
