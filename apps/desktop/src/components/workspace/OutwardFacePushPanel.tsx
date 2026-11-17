import { useEffect, useState } from "react";
import { coreClient } from "../../ipc/coreClient";
import { syncFromCoreList } from "../../model/sync";
import { selectionKindOf, useDocumentUiStore, useSelectionStore } from "../../stores";

/** Direct imported B-Rep edits never infer a face number from a tessellated mesh. */
export function OutwardFacePushPanel() {
  const ids = useSelectionStore(s => s.selectedIds);
  const features = useDocumentUiStore(s => s.features);
  const revision = useDocumentUiStore(s => s.revision);
  const epoch = useDocumentUiStore(s => s.epoch);
  const [distance, setDistance] = useState("5");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [planar, setPlanar] = useState(false);
  const id = ids.length === 1 ? ids[0] : undefined;
  const cut = id?.indexOf(":") ?? -1;
  const owner = cut > 0 ? id!.slice(0, cut) : "";
  const role = cut > 0 ? id!.slice(cut + 1) : "";
  const source = features.find(f => f.featureId === owner);
  const eligible = !!id && selectionKindOf(id) === "face" && source?.type === "StepImport" &&
    !!role && !/(?:^|[.:])(?:face|edge)\[\d+\]/i.test(role);
  useEffect(() => {
    let valid = true;
    setPlanar(false); setError("");
    if (!eligible) return;
    void coreClient.requestFaceInfo(owner, role).then(frame => {
      if (valid) setPlanar(frame.normal.every(Number.isFinite));
    }).catch(e => { if (valid) setError(e instanceof Error ? e.message : String(e)); });
    return () => { valid = false; };
  }, [eligible, owner, role, revision, epoch]);
  if (!eligible) return null;
  const run = async (direction: "out" | "in" | "thicken") => {
    const amount = Number(distance);
    if (!planar || !Number.isFinite(amount) || amount <= 0) { setError("Seleziona una faccia planare e una distanza positiva."); return; }
    const beforeEpoch = useDocumentUiStore.getState().epoch;
    const beforeRevision = useDocumentUiStore.getState().revision;
    setBusy(true); setError("");
    try {
      if (beforeEpoch !== epoch || beforeRevision !== revision) throw Error("Selezione non aggiornata.");
      if (direction === "out") await coreClient.createOutwardFacePush(owner, role, amount);
      else if (direction === "in") await coreClient.createInwardFacePocket(owner, role, amount);
      else await coreClient.createSurfaceFaceThicken(owner, role, amount);
      if (useDocumentUiStore.getState().epoch !== beforeEpoch) throw Error("Documento cambiato.");
      const snapshot = await coreClient.requestSnapshot();
      await syncFromCoreList(snapshot.features, snapshot.revision, snapshot.sketches, null, snapshot.datums);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <section data-testid="outward-face-push" className="mt-3 border-t border-white/10 p-3 text-xs text-white/70">
    <h3 className="mb-2 font-semibold text-white">Modifica faccia planare STEP</h3>
    <div className="truncate" title={role}>{role}</div>
    <label className="mt-2 block">Distanza estensione (mm)
      <input aria-label="Distanza estensione" type="number" min="0.001" step="any" value={distance} onChange={e => setDistance(e.target.value)} className="mt-1 w-full rounded bg-slate-800 p-1" />
    </label>
    <div className="mt-2 flex flex-wrap gap-2">
      <button disabled={!planar || busy} onClick={() => void run("out")} className="rounded bg-slate-700 px-2 py-1 disabled:opacity-40">Estendi faccia</button>
      <button disabled={!planar || busy} onClick={() => void run("in")} className="rounded bg-slate-700 px-2 py-1 disabled:opacity-40">Scava verso interno</button>
      <button disabled={!planar || busy} onClick={() => void run("thicken")} className="rounded bg-slate-700 px-2 py-1 disabled:opacity-40">Crea solido da faccia</button>
    </div>
    {busy && <p role="status">Elaborazione nativa…</p>}
    {error && <p role="alert" className="mt-2 text-red-300">{error}</p>}
  </section>;
}
