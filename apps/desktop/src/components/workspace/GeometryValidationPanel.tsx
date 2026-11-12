import { useEffect, useState } from "react";
import { coreClient } from "../../ipc/coreClient";
import { useDocumentUiStore, useSelectionStore } from "../../stores";

type Report = Awaited<ReturnType<typeof coreClient.validateCadGeometry>>;

export function GeometryValidationPanel() {
  const selectedIds = useSelectionStore(s => s.selectedIds);
  const features = useDocumentUiStore(s => s.features);
  const bodies = useDocumentUiStore(s => s.bodies);
  const revision = useDocumentUiStore(s => s.revision);
  const epoch = useDocumentUiStore(s => s.epoch);
  const documentId = useDocumentUiStore(s => s.documentId);
  const [target, setTarget] = useState("document");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const owner = selectedIds.length === 1 ? selectedIds[0]!.split(":")[0] : undefined;
  const body = bodies.find(b => b.bodyId === owner || b.history.includes(owner ?? ""));
  const feature = features.find(f => f.featureId === owner);
  const scope = target === "body" && body ? { bodyId: body.bodyId } :
    target === "feature" && feature ? { featureId: feature.featureId } : {};

  useEffect(() => { setReport(null); setError(""); }, [target, revision, epoch, documentId, owner]);
  const run = async () => {
    if ((target === "body" && !body) || (target === "feature" && !feature)) return;
    const stamp = { revision, epoch, documentId };
    setBusy(true);setError("");setReport(null);
    try {
      const result = await coreClient.validateCadGeometry(scope);
      const current = useDocumentUiStore.getState();
      if (current.revision !== stamp.revision || current.epoch !== stamp.epoch || current.documentId !== stamp.documentId)
        throw Error("Il documento è cambiato; ripeti la verifica.");
      setReport(result);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <section data-testid="geometry-validation-panel" className="mt-3 border-t border-white/10 p-3 text-xs text-white/70">
    <h3 className="mb-2 font-semibold text-white">Verifica CAD nativa (B-Rep)</h3>
    <select aria-label="Ambito verifica CAD" value={target} onChange={e => setTarget(e.target.value)} className="w-full rounded bg-slate-800 p-1">
      <option value="document">Intero documento</option>
      <option value="body" disabled={!body}>Corpo selezionato</option>
      <option value="feature" disabled={!feature}>Feature selezionata</option>
    </select>
    <button disabled={busy} onClick={() => void run()} className="mt-2 rounded bg-slate-700 px-2 py-1 disabled:opacity-50">Esegui verifica</button>
    {busy && <p role="status">Verifica in corso…</p>}
    {error && <p role="alert" className="mt-2 text-red-300">{error}</p>}
    {report && <div className="mt-2" aria-live="polite">
      <p className={report.valid ? "text-green-300" : "text-red-300"}>{report.valid ? "Geometria valida" : "Problemi rilevati"} — {report.checks.filter(c => c.ok).length}/{report.checks.length} controlli superati</p>
      <div className="mt-2 max-h-48 overflow-y-auto">{report.checks.map((c, i) => <div key={`${c.code}-${c.detail}-${i}`} className="border-b border-white/10 py-1">
        <span className={c.ok ? "text-green-300" : "text-red-300"}>{c.ok ? "OK" : "Errore"}</span> {c.code}: {c.detail}
      </div>)}</div>
    </div>}
  </section>;
}
