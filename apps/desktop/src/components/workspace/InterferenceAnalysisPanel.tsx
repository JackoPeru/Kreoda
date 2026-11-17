import { useEffect, useRef, useState } from "react";
import { coreClient, type InterferenceAnalysis } from "../../ipc/coreClient";
import { useDocumentUiStore, useSelectionStore } from "../../stores";

type Bodies = ReturnType<typeof useDocumentUiStore.getState>["bodies"];
function selectedComponents(ids: string[], bodies: Bodies): string[] {
  return [...new Set(ids.map(id => {
    const owner = id.split(":")[0]!;
    return bodies.find(body => body.bodyId === owner || body.history.includes(owner))?.tipFeatureId ?? owner;
  }).filter(Boolean))].sort();
}

export function InterferenceAnalysisPanel() {
  const selected = useSelectionStore(s => s.selectedIds);
  const bodies = useDocumentUiStore(s => s.bodies);
  const documentId = useDocumentUiStore(s => s.documentId);
  const revision = useDocumentUiStore(s => s.revision);
  const epoch = useDocumentUiStore(s => s.epoch);
  const [scope, setScope] = useState("document");
  const [tolerance, setTolerance] = useState("0.000001");
  const [result, setResult] = useState<InterferenceAnalysis | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const ids = selectedComponents(selected, bodies);
  const selectionKey = scope === "selection" ? JSON.stringify(ids) : "";
  const threshold = Number(tolerance.replace(",", "."));
  const valid = tolerance.trim() !== "" && Number.isFinite(threshold) && threshold >= 0 &&
    (scope !== "selection" || (ids.length >= 2 && ids.length <= 128));
  useEffect(() => {
    generation.current++;
    setResult(null); setError(""); setBusy(false);
    return () => { generation.current++; };
  }, [documentId, revision, epoch, scope, tolerance, selectionKey]);

  const analyze = async () => {
    if (!valid || busy) return;
    const ticket = ++generation.current;
    setResult(null); setError(""); setBusy(true);
    try {
      const measured = await coreClient.measureInterferences({
        ...(scope === "selection" ? { featureIds: ids } : {}), volumeToleranceMm3: threshold,
      });
      const current = useDocumentUiStore.getState();
      if (generation.current !== ticket || current.documentId !== documentId || current.epoch !== epoch || current.revision !== revision)
        return;
      if (scope === "selection" && JSON.stringify(selectedComponents(useSelectionStore.getState().selectedIds, current.bodies)) !== selectionKey)
        return;
      setResult(measured);
    } catch (cause) {
      if (generation.current === ticket) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (generation.current === ticket) setBusy(false); }
  };

  return <section data-testid="interference-analysis-panel" className="mt-3 border-t border-white/10 p-3 text-xs text-white/70">
    <h3 className="mb-2 font-semibold text-white">Interferenze tra componenti</h3>
    <select aria-label="Ambito interferenze" value={scope} onChange={e => setScope(e.target.value)} className="w-full rounded bg-slate-800 p-1">
      <option value="document">Solidi visibili</option>
      <option value="selection" disabled={ids.length < 2 || ids.length > 128}>Componenti selezionati</option>
    </select>
    <label className="mt-2 flex items-center justify-between gap-2">Soglia volume (mm³)
      <input aria-label="Soglia volume interferenza mm³" value={tolerance} onChange={e => setTolerance(e.target.value)}
        className="w-24 min-w-0 rounded bg-slate-800 p-1" inputMode="decimal" />
    </label>
    <button disabled={!valid || busy} onClick={() => void analyze()} className="mt-2 rounded bg-slate-700 px-2 py-1 disabled:opacity-40">Controlla interferenze</button>
    {busy && <p role="status">Analisi in corso…</p>}
    {error && <p role="alert" className="mt-2 text-red-300">{error}</p>}
    {result && <div aria-live="polite" className="mt-2">
      <p>{result.componentCount} componenti solidi analizzati.</p>
      {result.interferences.length === 0 ? <p>Nessuna interferenza volumetrica.</p> :
        <div className="max-h-56 overflow-auto">{result.interferences.map(pair => <div key={`${pair.featureA}/${pair.featureB}`} className="border-b border-white/10 py-2">
          <p className="break-all font-mono">{pair.featureA} ↔ {pair.featureB}</p>
          <p className="text-amber-300">{pair.volumeMm3.toLocaleString("it-IT", { maximumFractionDigits: 6 })} mm³</p>
          <button className="mt-1 text-cyan-300" onClick={() => {
            useSelectionStore.getState().select(pair.featureA, false);
            useSelectionStore.getState().select(pair.featureB, true);
          }}>Seleziona componenti</button>
        </div>)}</div>}
      {result.skippedNonSolidFeatureIds.length > 0 && <p className="mt-1 text-white/45">{result.skippedNonSolidFeatureIds.length} componenti senza volume esclusi.</p>}
    </div>}
  </section>;
}
