import { useEffect, useState } from "react";
import { coreClient, type MassProperties } from "../../ipc/coreClient";
import { useDocumentUiStore, useSelectionStore } from "../../stores";

export function MassAnalysisPanel() {
  const selected = useSelectionStore(s => s.selectedIds[0]);
  const features = useDocumentUiStore(s => s.features);
  const bodies = useDocumentUiStore(s => s.bodies);
  const revision = useDocumentUiStore(s => s.revision);
  const documentId = useDocumentUiStore(s => s.documentId);
  const epoch = useDocumentUiStore(s => s.epoch);
  const [density, setDensity] = useState("7850");
  const [data, setData] = useState<MassProperties | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const owner = selected?.split(":")[0];
  const body = bodies.find(item => item.bodyId === owner);
  const feature = features.find(item => item.featureId === owner);
  const scope = body ? { bodyId: body.bodyId } : feature ? { featureId: feature.featureId } : null;
  const scopeId = scope?.bodyId ?? scope?.featureId;
  const validDensity = Number(density) > 0 && Number.isFinite(Number(density));

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    if (!scope || !validDensity) return;
    setLoading(true);
    void coreClient.measureMassProperties({ ...scope, densityKgPerM3: Number(density) })
      .then(result => { if (!cancelled) setData(result); })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scopeId, documentId, revision, epoch, density, validDensity]);

  if (!scope) return null;
  const number = (value: number) => value.toLocaleString("it-IT", { maximumFractionDigits: 4 });
  return <section data-testid="mass-analysis" className="mt-3 border-t border-white/10 px-3 pt-3 text-xs text-white/70">
    <h3 className="mb-2 font-semibold text-white">Analisi geometrica · B-Rep</h3>
    <label className="flex items-center justify-between gap-2">Densità (kg/m³)
      <input aria-label="Densità (kg/m³)" type="number" min="0.001" step="any" value={density}
        onChange={e => setDensity(e.target.value)} className="w-24 rounded bg-white/10 px-2 py-1 text-right text-white" />
    </label>
    {!validDensity && <p role="alert">Inserisci una densità positiva.</p>}
    {loading && <p role="status">Misurazione in corso…</p>}
    {error && <p role="alert" className="mt-2 text-red-300">{error}</p>}
    {data && !loading && <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
      <dt>Volume</dt><dd className="text-right">{number(data.volumeMm3)} mm³</dd>
      <dt>Superficie</dt><dd className="text-right">{number(data.areaMm2)} mm²</dd>
      <dt>Baricentro</dt><dd className="text-right">{data.centroidMm.map(number).join(" / ")} mm</dd>
      <dt>Massa</dt><dd className="text-right">{data.massKg === undefined ? "Non disponibile" : `${number(data.massKg)} kg`}</dd>
    </dl>}
  </section>;
}
