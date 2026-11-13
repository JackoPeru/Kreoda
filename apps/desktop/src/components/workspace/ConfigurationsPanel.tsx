import { useEffect, useState } from "react";
import { CommandType } from "@kreoda/protocol";
import { coreClient } from "../../ipc/coreClient";
import { syncFromCoreList } from "../../model/sync";
import { useDocumentUiStore, useSelectionStore } from "../../stores";

const PARAMETERS: Record<string, string[]> = {
  Box: ["widthMm", "heightMm", "depthMm"], Cylinder: ["radiusMm", "heightMm"],
  Sphere: ["radiusMm"], Extrude: ["distanceMm"], Revolve: ["angleDeg"],
};

export function ConfigurationsPanel() {
  const selectedId = useSelectionStore(s => s.selectedIds[0]);
  const features = useDocumentUiStore(s => s.features);
  const revision = useDocumentUiStore(s => s.revision);
  const epoch = useDocumentUiStore(s => s.epoch);
  const feature = features.find(f => f.featureId === selectedId);
  const editable = feature ? PARAMETERS[feature.type] ?? [] : [];
  const [name, setName] = useState("");
  const [param, setParam] = useState("");
  const [value, setValue] = useState("");
  const [selectedConfig, setSelectedConfig] = useState("");
  const [configs, setConfigs] = useState<string[]>([]);
  const [active, setActive] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    void coreClient.queryConfigurations().then(result => {
      if (!current) return;
      setConfigs(Object.keys(result.named)); setActive(result.active);
    }).catch(e => { if (current) setError(String(e instanceof Error ? e.message : e)); });
    return () => { current = false; };
  }, [revision, epoch]);

  const run = async (kind: "define" | "activate") => {
    const expectedRevision = useDocumentUiStore.getState().revision;
    const expectedEpoch = useDocumentUiStore.getState().epoch;
    const number = Number(value);
    if (kind === "define" && (!feature || !editable.includes(param) || !value.trim() || !Number.isFinite(number))) {
      setError("Seleziona un parametro modificabile e un valore numerico valido."); return;
    }
    if (kind === "define" && !name.trim()) { setError("Seleziona un nome di configurazione."); return; }
    setBusy(true); setError("");
    try {
      const before = await coreClient.queryConfigurations();
      if (before.revision !== expectedRevision || useDocumentUiStore.getState().epoch !== expectedEpoch ||
          useDocumentUiStore.getState().revision !== expectedRevision) throw Error("Modello modificato: riprova dopo l'aggiornamento.");
      if (kind === "define") {
        const configName = name.trim();
        const previous = before.named[configName] ?? {};
        await coreClient.configurationCommand(CommandType.DefineConfiguration, {
          name: configName,
          overrides: {
            ...previous,
            [feature!.featureId]: { ...previous[feature!.featureId], [param]: number },
          },
        });
      }
      else await coreClient.configurationCommand(CommandType.ActivateConfiguration, { name: selectedConfig });
      if (useDocumentUiStore.getState().epoch !== expectedEpoch) throw Error("Documento cambiato durante l'operazione.");
      const snapshot = await coreClient.requestSnapshot();
      await syncFromCoreList(snapshot.features, snapshot.revision, snapshot.sketches, null, snapshot.datums);
      const latest = await coreClient.queryConfigurations();
      setConfigs(Object.keys(latest.named)); setActive(latest.active);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return <section data-testid="configurations-panel" className="mt-3 border-t border-white/10 p-3 text-xs text-white/70">
    <h3 className="mb-2 font-semibold text-white">Configurazioni</h3>
    <p>Attiva: {active || "Base"}</p>
    <select aria-label="Configurazione salvata" value={selectedConfig} onChange={e => setSelectedConfig(e.target.value)} className="mt-2 w-full bg-slate-800 p-1">
      <option value="">Base</option>
      {configs.map(item => <option key={item} value={item}>{item}</option>)}
    </select>
    <button disabled={busy} onClick={() => void run("activate")} className="mt-1 rounded bg-slate-700 px-2 py-1 disabled:opacity-40">Attiva selezionata</button>
    {editable.length > 0 && <div className="mt-3 grid gap-1">
      <input aria-label="Nome nuova configurazione" placeholder="Nome configurazione" value={name} onChange={e => setName(e.target.value)} className="bg-slate-800 p-1" />
      <select aria-label="Parametro da sovrascrivere" value={param} onChange={e => setParam(e.target.value)} className="bg-slate-800 p-1">
        <option value="">Seleziona parametro</option>{editable.map(item => <option key={item} value={item}>{item}</option>)}
      </select>
      <input aria-label="Valore override" placeholder="Valore" value={value} onChange={e => setValue(e.target.value)} className="bg-slate-800 p-1" />
      <button disabled={busy} onClick={() => void run("define")} className="rounded bg-slate-700 px-2 py-1 disabled:opacity-40">Salva configurazione</button>
    </div>}
    {busy && <p role="status">Elaborazione…</p>}
    {error && <p role="alert" className="mt-2 text-red-300">{error}</p>}
  </section>;
}
