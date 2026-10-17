import { useEffect, useMemo, useState } from "react";
import type { SketchProjectionDefinition, SketchProjectionSource } from "@kreoda/protocol";
import { coreClient } from "../../ipc/coreClient";
import { refreshSketchProjection, syncSketchProjectionMutation } from "../../model/sync";
import { useDocumentUiStore, useSelectionStore } from "../../stores";
import { useT } from "../../i18n";

type Operation = SketchProjectionDefinition["operation"];
type SourceOption = { key: string; label: string; source: SketchProjectionSource };

export function SketchProjectionPanel({ sketchId }: { sketchId: string }) {
  const tt = useT();
  const sketch = useDocumentUiStore(s => s.sketches.find(item => item.featureId === sketchId));
  const sketches = useDocumentUiStore(s => s.sketches);
  const features = useDocumentUiStore(s => s.features);
  const meshes = useDocumentUiStore(s => s.meshes);
  const revision = useDocumentUiStore(s => s.revision);
  const documentId = useDocumentUiStore(s => s.documentId);
  const epoch = useDocumentUiStore(s => s.epoch);
  const connectionGeneration = useDocumentUiStore(s => s.connectionGeneration);
  const selectedIds = useSelectionStore(s => s.selectedIds);
  const [operation, setOperation] = useState<Operation>("projectEdges");
  const [sourceKey, setSourceKey] = useState("");
  const [groupId, setGroupId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const groups = sketch?.projectionGroups ?? [];
  const active = groups.find(group => group.groupId === groupId);
  useEffect(() => {
    const candidates = sketches.filter(source => source.featureId !== sketchId && !source.model && source.geometryCurrent !== false);
    if (candidates.length === 0) return;
    const context = { documentId, revision, epoch, connectionGeneration };
    let cancelled = false;
    void (async () => {
      try {
        const before = await window.kreoda.sessionSnapshot() as { sessionId?: string; documentId: string; revision: number };
        if (cancelled || before.documentId !== context.documentId || before.revision !== context.revision ||
            typeof before.sessionId !== "string" || coreClient.documentId !== context.documentId) return;
        const results = await Promise.all(candidates.map(async source => {
          try {
            const model = await coreClient.requestSketch(source.featureId);
            return model.revision === context.revision ? { featureId: source.featureId, model } : null;
          } catch { return null; }
        }));
        const after = await window.kreoda.sessionSnapshot() as { sessionId?: string; documentId: string; revision: number };
        if (cancelled || after.sessionId !== before.sessionId || after.documentId !== context.documentId || after.revision !== context.revision) return;
        const state = useDocumentUiStore.getState();
        if (state.documentId !== context.documentId || state.revision !== context.revision || state.epoch !== context.epoch ||
            state.connectionGeneration !== context.connectionGeneration) return;
        const loaded = new Map(results.filter((item): item is NonNullable<typeof item> => item !== null).map(item => [item.featureId, item.model]));
        if (loaded.size === 0) return;
        state.setSketches(state.sketches.map(item => {
          const model = loaded.get(item.featureId);
          if (!model) return item;
          return {
            ...item,
            planeKind: model.planeKind,
            plane: model.plane,
            supportRef: model.supportRef,
            points: model.points.length,
            lines: model.lines.length,
            circles: model.circles.length,
            constraints: model.constraints.length,
            projectionGroups: model.projectionGroups,
            geometryCurrent: model.geometryCurrent,
            status: model.status,
            error: model.error,
            blockingSourceIds: model.blockingSourceIds,
            model,
          };
        }), context.revision, context.epoch);
      } catch {
        // A stale or unavailable source never becomes a selectable binding.
      }
    })();
    return () => { cancelled = true; };
  }, [sketchId, documentId, revision, epoch, connectionGeneration, sketches]);
  const options = useMemo<SourceOption[]>(() => {
    const available = features.filter(feature => feature.geometryCurrent !== false && feature.status !== "unavailable");
    if (operation === "projectEdges") return [
      ...available.flatMap(feature => (meshes[feature.featureId]?.edges ?? [])
      .filter(edge => edge.persistentEdgeId.startsWith(`${feature.featureId}:`))
      .map(edge => ({ key: `edge:${edge.persistentEdgeId}`, label: `${feature.type} · ${edge.persistentEdgeId}`,
        source: { type: "edge", featureId: feature.featureId, persistentEdgeId: edge.persistentEdgeId } as const }))),
      ...sketches.filter(source => source.featureId !== sketchId && source.model && source.geometryCurrent !== false)
        .map(source => ({
          key: `sketch:${source.featureId}`, label: `Sketch · ${source.featureId}`,
          source: { type: "sketchEntities", featureId: source.featureId,
            entityIds: [...source.model!.lines, ...source.model!.circles, ...source.model!.arcs].map(entity => entity.id) } as SketchProjectionSource,
        })).filter(option => option.source.type === "sketchEntities" && (option.source.entityIds?.length ?? 0) > 0),
    ];
    return available.filter(feature => meshes[feature.featureId] !== undefined)
      .map(feature => ({ key: `shape:${feature.featureId}`, label: `${feature.type} · ${feature.featureId}`,
        source: { type: "shape", featureId: feature.featureId } as const }));
  }, [features, meshes, revision, operation, sketches, sketchId]);

  const useSelection = (): void => {
    const id = selectedIds[0];
    if (!id) return;
    const state = useDocumentUiStore.getState();
    const owner = id.includes(":") ? id.slice(0, id.indexOf(":")) : id;
    const option = operation === "projectEdges"
      ? options.find(item => item.key === `edge:${id}` && state.meshes[owner]?.edges.some(edge => edge.persistentEdgeId === id))
        ?? options.find(item => item.key === `sketch:${id}`)
      : options.find(item => item.key === `shape:${owner}`);
    if (option) setSourceKey(option.key);
  };

  const inspect = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try { await refreshSketchProjection(sketchId); }
    catch (e) { setError(e instanceof Error ? e.message : tt("sketch.projection.failed")); }
    finally { setBusy(false); }
  };

  const apply = async (repair: boolean): Promise<void> => {
    const source = options.find(item => item.key === sourceKey)?.source;
    const id = repair ? active?.groupId : `pg-${crypto.randomUUID()}`;
    if (!source || !id || (repair && !active)) return;
    const expectedDocument = documentId;
    const expectedEpoch = epoch;
    const definition: SketchProjectionDefinition = { version: 1, operation, sources: [source] };
    setError(null);
    setBusy(true);
    useDocumentUiStore.getState().clearSketchProjection(sketchId);
    try {
      const result = await coreClient.setSketchProjection(sketchId, id, definition);
      if (useDocumentUiStore.getState().documentId !== expectedDocument || useDocumentUiStore.getState().epoch !== expectedEpoch) return;
      setGroupId(id);
      await syncSketchProjectionMutation(result, expectedDocument, expectedEpoch);
    } catch (e) { setError(e instanceof Error ? e.message : tt("sketch.projection.failed")); }
    finally { setBusy(false); }
  };

  const remove = async (): Promise<void> => {
    if (!active) return;
    const expectedDocument = documentId;
    const expectedEpoch = epoch;
    setError(null);
    setBusy(true);
    useDocumentUiStore.getState().clearSketchProjection(sketchId);
    try {
      const result = await coreClient.removeSketchProjection(sketchId, active.groupId);
      if (useDocumentUiStore.getState().documentId !== expectedDocument || useDocumentUiStore.getState().epoch !== expectedEpoch) return;
      setGroupId("");
      await syncSketchProjectionMutation(result, expectedDocument, expectedEpoch);
    } catch (e) { setError(e instanceof Error ? e.message : tt("sketch.projection.failed")); }
    finally { setBusy(false); }
  };

  return (
    <details data-testid="sketch-projection-panel" className="mb-2 rounded-md border border-white/10 bg-white/[0.03] text-[11px]">
      <summary className="cursor-pointer select-none px-2 py-1.5 text-white/75">
        {tt("sketch.projection.title", { n: groups.length })}
      </summary>
      <div className="space-y-1.5 px-2 pb-2 text-white/70">
        <div className="flex gap-1.5">
          <select aria-label={tt("sketch.projection.operation")} value={operation} disabled={busy}
            onChange={e => { setOperation(e.target.value as Operation); setSourceKey(""); }}
            className="min-w-0 flex-1 rounded bg-white/5 px-1.5 py-1 text-white">
            <option value="projectEdges">projectEdges</option><option value="silhouette">silhouette</option><option value="section">section</option>
          </select>
          <select aria-label={tt("sketch.projection.group")} value={groupId} disabled={busy}
            onChange={e => {
              const next = groups.find(group => group.groupId === e.target.value);
              setGroupId(e.target.value);
              if (next) {
                setOperation(next.definition.operation);
                setSourceKey("");
              }
            }} className="min-w-0 flex-1 rounded bg-white/5 px-1.5 py-1 text-white">
            <option value="">{tt("sketch.projection.newGroup")}</option>
            {groups.map(group => <option key={group.groupId} value={group.groupId}>{group.groupId.slice(0, 14)} · {group.status}</option>)}
          </select>
        </div>
        <div className="flex gap-1.5">
          <select aria-label={tt("sketch.projection.source")} value={sourceKey} disabled={busy}
            onChange={e => setSourceKey(e.target.value)} className="min-w-0 flex-1 rounded bg-white/5 px-1.5 py-1 text-white">
            <option value="">{tt("sketch.projection.chooseSource")}</option>
            {options.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
          <button type="button" disabled={busy || selectedIds.length === 0} onClick={useSelection}
            className="rounded bg-white/10 px-2 py-1 disabled:opacity-40">{tt("sketch.projection.useSelection")}</button>
        </div>
        {active && <div className="truncate font-mono text-white/55" title={`${active.groupId} · ${active.sourceFeatureIds.join(", ")}`}>
          {active.groupId} · {active.status} · {active.sourceFeatureIds.join(", ")}
          {active.error ? ` · ${active.error}` : ""}
        </div>}
        {error && <div role="alert" className="text-red-300">{error}</div>}
        <div className="flex flex-wrap gap-1.5">
          <button type="button" disabled={busy} onClick={() => void inspect()} className="rounded bg-white/10 px-2 py-1">{tt("sketch.projection.inspect")}</button>
          <button type="button" disabled={busy || !sourceKey} onClick={() => void apply(false)} className="rounded bg-white/10 px-2 py-1">{tt("sketch.projection.create")}</button>
          <button type="button" disabled={busy || !active || !sourceKey} onClick={() => void apply(true)} className="rounded bg-white/10 px-2 py-1">{tt("sketch.projection.repair")}</button>
          <button type="button" disabled={busy || !active} onClick={() => void remove()} className="rounded bg-white/10 px-2 py-1">{tt("sketch.projection.remove")}</button>
        </div>
      </div>
    </details>
  );
}
