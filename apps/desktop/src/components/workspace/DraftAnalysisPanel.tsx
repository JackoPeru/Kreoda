import { useEffect, useState } from "react";
import { coreClient } from "../../ipc/coreClient";
import { useDocumentUiStore, useSelectionStore } from "../../stores";

type Result = Awaited<ReturnType<typeof coreClient.measureDraftAngles>>;

export function DraftAnalysisPanel() {
  const selected = useSelectionStore(s => s.selectedIds);
  const features = useDocumentUiStore(s => s.features);
  const bodies = useDocumentUiStore(s => s.bodies);
  const revision = useDocumentUiStore(s => s.revision);
  const epoch = useDocumentUiStore(s => s.epoch);
  const documentId = useDocumentUiStore(s => s.documentId);
  const owner = selected.length === 1 ? selected[0]!.split(":")[0] : "";
  const feature = features.find(f => f.featureId === owner);
  const body = bodies.find(b => b.bodyId === owner || b.history.includes(owner));
  const [scope, setScope] = useState("document");
  const [direction, setDirection] = useState<[string, string, string]>(["0", "0", "1"]);
  const [tolerance, setTolerance] = useState("1");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setResult(null); setError(""); }, [scope, direction, tolerance, owner, revision, epoch, documentId]);
  const vector = direction.map(Number) as [number, number, number];
  const valid = direction.every(x => x.trim() !== "") && vector.every(Number.isFinite) && Math.hypot(...vector) > 1e-12 &&
    tolerance.trim() !== "" && Number.isFinite(Number(tolerance)) && Number(tolerance) >= 0 && Number(tolerance) <= 90 &&
    (scope !== "feature" || !!feature) && (scope !== "body" || !!body);
  const analyze = async () => {
    if (!valid) return;
    const stamp = { documentId, epoch, revision, owner, scope };
    setResult(null); setError(""); setBusy(true);
    try {
      const analysis = await coreClient.measureDraftAngles({
        ...(scope === "body" && body ? { bodyId: body.bodyId } : {}),
        ...(scope === "feature" && feature ? { featureId: feature.featureId } : {}),
        pullDirection: vector, neutralToleranceDeg: Number(tolerance),
      });
      const state = useDocumentUiStore.getState();
      if (state.documentId !== stamp.documentId || state.revision !== stamp.revision || state.epoch !== stamp.epoch)
        throw Error("Documento modificato durante l'analisi; ripeti la richiesta.");
      setResult(analysis);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <section data-testid="draft-analysis-panel" className="mt-3 border-t border-white/10 p-3 text-xs text-white/70">
    <h3 className="mb-2 font-semibold text-white">Analisi angoli di sformo</h3>
    <select aria-label="Ambito analisi sformo" value={scope} onChange={e => setScope(e.target.value)} className="w-full rounded bg-slate-800 p-1">
      <option value="document">Documento</option><option value="body" disabled={!body}>Corpo selezionato</option><option value="feature" disabled={!feature}>Feature selezionata</option>
    </select>
    <div className="mt-2 flex gap-1">{direction.map((value, index) => <input key={index} aria-label={`Direzione estrazione ${["X", "Y", "Z"][index]}`}
      value={value} onChange={e => setDirection(old => old.map((v, i) => i === index ? e.target.value : v) as [string,string,string])}
      className="w-1/3 min-w-0 rounded bg-slate-800 p-1" />)}</div>
    <label className="mt-2 flex items-center justify-between">Tolleranza neutra (°)<input aria-label="Tolleranza neutra gradi" value={tolerance} onChange={e => setTolerance(e.target.value)} className="w-20 rounded bg-slate-800 p-1" /></label>
    <button disabled={!valid || busy} onClick={() => void analyze()} className="mt-2 rounded bg-slate-700 px-2 py-1 disabled:opacity-40">Calcola sformi</button>
    {busy && <p role="status">Analisi in corso…</p>}
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {result && <div aria-live="polite" className="mt-2"><p>{result.faces.length} facce analizzate</p>
      <div className="max-h-60 overflow-y-auto">{result.faces.map(f => <div key={f.referenceId} className="border-b border-white/10 py-1">
        <div className="font-mono break-all">{f.referenceId}</div>
        <div>{f.classification} · {f.draftAngleDeg.toFixed(2)}°</div>
        <div className="text-white/45">Normale: {f.normal.map(n => n.toFixed(3)).join(", ")}</div>
      </div>)}</div>
    </div>}
  </section>;
}
