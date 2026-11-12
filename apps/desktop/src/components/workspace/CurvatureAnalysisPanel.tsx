import { useMemo } from "react";
import { useZebraStore } from "../../analysis/zebra";
import { useDocumentUiStore } from "../../stores";

export function CurvatureAnalysisPanel() {
  const settings = useZebraStore(s => s.curvature);
  const update = useZebraStore(s => s.setCurvature);
  const meshes = useDocumentUiStore(s => s.meshes);
  const summary = useMemo(() => {
    let known = 0, unknown = 0, maximum = 0;
    for (const mesh of Object.values(meshes)) {
      const values = mesh.curvatureMaxAbsPerMm;
      if (!values || values.length !== mesh.positions.length / 3) { unknown += mesh.positions.length / 3; continue; }
      for (const value of values) {
        if (value < 0) ++unknown;
        else { ++known; maximum = Math.max(maximum, value); }
      }
    }
    return { known, unknown, maximum };
  }, [meshes]);
  return <section data-testid="curvature-analysis-panel" className="mt-3 border-t border-white/10 p-3 text-xs text-white/70">
    <label className="flex items-center justify-between gap-2 font-semibold text-white">Curvatura della superficie
      <input type="checkbox" aria-label="Analisi curvatura" checked={settings.enabled} disabled={!summary.known && !settings.enabled}
        onChange={event => update({ enabled: event.target.checked })} />
    </label>
    {!summary.known && <p className="mt-2 text-white/45">Curvatura non disponibile per questa mesh.</p>}
    {settings.enabled && <>
      <label className="mt-2 flex items-center justify-between gap-2">Massimo (mm⁻¹)
        <input type="number" step="any" min="0" aria-label="Massimo curvatura mm inversi" value={settings.maximumPerMm}
          onChange={event => update({ maximumPerMm: event.currentTarget.valueAsNumber })} className="w-24 rounded bg-slate-800 p-1" />
      </label>
      <button disabled={summary.maximum <= 0} onClick={() => update({ maximumPerMm: summary.maximum })}
        className="mt-2 rounded bg-slate-700 px-2 py-1 disabled:opacity-40">Scala automatica</button>
      <div className="mt-2 h-2 rounded" aria-hidden="true" style={{ background: "linear-gradient(90deg,#1f52f2,#1acc8c,#f22e1f)" }} />
      <p aria-label="Legenda curvatura" className="mt-1">Blu: 0 (piano) · Rosso: {settings.maximumPerMm.toPrecision(4)} mm⁻¹</p>
      <p className="mt-1">Raggio minimo della scala: {(1 / settings.maximumPerMm).toPrecision(4)} mm</p>
      <p className="mt-2 text-white/45">Massima curvatura principale assoluta. Mappa campionata: non certifica la continuità.</p>
      {!!summary.unknown && <p className="mt-1 text-white/45">Grigio: {summary.unknown.toLocaleString()} campioni non disponibili.</p>}
    </>}
  </section>;
}
