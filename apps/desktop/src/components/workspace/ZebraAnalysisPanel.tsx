import { useZebraStore } from "../../analysis/zebra";
import { useDocumentUiStore } from "../../stores";

export function ZebraAnalysisPanel() {
  const { enabled, bands, angleDeg, update } = useZebraStore();
  const hasMesh = useDocumentUiStore(s => Object.keys(s.meshes).length > 0);
  return <section data-testid="zebra-analysis-panel" className="mt-3 border-t border-white/10 p-3 text-xs text-white/70">
    <label className="flex items-center justify-between gap-2 font-semibold text-white">Analisi zebra
      <input type="checkbox" aria-label="Analisi zebra" checked={enabled} disabled={!hasMesh && !enabled}
        onChange={event => update({ enabled: event.target.checked })} />
    </label>
    {enabled && <>
      <label className="mt-2 flex items-center justify-between gap-2">Densità bande
        <input type="range" aria-label="Densità bande zebra" min="4" max="48" step="1" value={bands}
          onChange={event => update({ bands: Number(event.target.value) })} />
      </label>
      <label className="mt-2 flex items-center justify-between gap-2">Orientamento ({angleDeg}°)
        <input type="range" aria-label="Orientamento zebra" min="0" max="180" step="1" value={angleDeg}
          onChange={event => update({ angleDeg: Number(event.target.value) })} />
      </label>
      <p className="mt-2 text-white/45">Ruota la vista per osservare la continuità delle bande. La precisione visiva dipende dalla tessellazione.</p>
    </>}
  </section>;
}
