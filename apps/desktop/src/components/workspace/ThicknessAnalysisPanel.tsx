import { useEffect, useRef, useState } from "react";
import { coreClient, type MinimumThicknessAnalysis } from "../../ipc/coreClient";
import { useDocumentUiStore, useSelectionStore } from "../../stores";

export function ThicknessAnalysisPanel() {
  const selected = useSelectionStore(s => s.selectedIds);
  const features = useDocumentUiStore(s => s.features);
  const bodies = useDocumentUiStore(s => s.bodies);
  const documentId = useDocumentUiStore(s => s.documentId);
  const revision = useDocumentUiStore(s => s.revision);
  const epoch = useDocumentUiStore(s => s.epoch);
  const owner = selected.length === 1 ? selected[0]!.split(":")[0] : "";
  const body = bodies.find(item => item.bodyId === owner);
  const feature = features.find(item => item.featureId === owner);
  const scope = body ? { bodyId: body.bodyId } : feature ? { featureId: feature.featureId } : null;
  const [samples, setSamples] = useState("512");
  const [result, setResult] = useState<MinimumThicknessAnalysis | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const selectionKey = JSON.stringify(selected);
  const scopeId = scope?.bodyId ?? scope?.featureId;
  useEffect(() => {
    generation.current++;setResult(null);setError("");setBusy(false);
    return () => { generation.current++; };
  }, [documentId, revision, epoch, selectionKey, scopeId, samples]);
  const analyze = async () => {
    if (!scope || busy) return;
    const ticket = ++generation.current;
    setResult(null);setError("");setBusy(true);
    try {
      const measured = await coreClient.measureMinimumThickness({ ...scope, maxSamples: Number(samples) });
      const current = useDocumentUiStore.getState();
      if (ticket !== generation.current || current.documentId !== documentId || current.epoch !== epoch ||
        current.revision !== revision || JSON.stringify(useSelectionStore.getState().selectedIds) !== selectionKey) return;
      setResult(measured);
    } catch (cause) { if (ticket === generation.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (ticket === generation.current) setBusy(false); }
  };
  const number = (value: number) => value.toLocaleString("it-IT", { maximumFractionDigits: 4 });
  return <section data-testid="thickness-analysis-panel" className="mt-3 border-t border-white/10 p-3 text-xs text-white/70">
    <h3 className="mb-2 font-semibold text-white">Spessore minimo rilevato</h3>
    <p className="text-white/45">Analisi campionata: può non rilevare zone più sottili.</p>
    {!scope && <p className="mt-2">Seleziona un corpo o una feature solida.</p>}
    <label className="mt-2 flex items-center justify-between">Campionamento
      <select aria-label="Campionamento spessore" value={samples} onChange={e => setSamples(e.target.value)} className="rounded bg-slate-800 p-1">
        <option value="512">512 punti</option><option value="2048">2048 punti</option>
      </select>
    </label>
    <button disabled={!scope || busy} onClick={() => void analyze()} className="mt-2 rounded bg-slate-700 px-2 py-1 disabled:opacity-40">Calcola spessore</button>
    {busy && <p role="status">Analisi B-Rep in corso…</p>}
    {error && <p role="alert" className="mt-2 text-red-300">{error}</p>}
    {result && <div aria-live="polite" className="mt-2 space-y-1">
      <strong className="text-white">{result.minimumThicknessMm === null ? "Nessuna misura disponibile" : `${number(result.minimumThicknessMm)} mm`}</strong>
      <p>{result.validSamples} / {result.attemptedSamples} misure · {result.sampledFaces} / {result.totalFaces} facce</p>
      {result.witness && <div className="break-words font-mono text-white/50">
        <p>A: {result.witness.pointAMm.map(number).join(", ")} mm</p>
        <p>B: {result.witness.pointBMm.map(number).join(", ")} mm</p>
      </div>}
      {(result.missedSamples > 0 || result.sampledFaces < result.totalFaces || result.timeBudgetExceeded) &&
        <p className="text-amber-200">Copertura incompleta · aumenta il campionamento per approfondire.</p>}
    </div>}
  </section>;
}
