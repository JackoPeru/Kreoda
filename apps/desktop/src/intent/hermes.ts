import type { SessionModelEntity, SessionModelSnapshot, VoiceTurnParams } from "@kreoda/protocol";
import { useDocumentUiStore, useSelectionStore } from "../stores";
import { useSharedTargetStore } from "../model/shared-targets";
import { getLocale, type Locale } from "../i18n";

type Selection = Readonly<{ kind: "body" | "face" | "edge" | "instance" | "sketch" | "datumPlane" | "datumAxis" | "datumPoint";
  persistentId: string; featureId: string; bodyId?: string; instanceId?: string }>;
export interface HermesReview {
  readonly text: string;
  readonly locale: Locale;
  readonly sessionId: string;
  readonly documentId: string;
  readonly revision: number;
  readonly epoch: number;
  readonly connectionGeneration: number;
  readonly selectionIds: readonly string[];
  readonly selections: readonly Selection[];
}
const stale = () => new Error("CAD_CONTEXT_CHANGED");
const invalid = () => new Error("CAD_SELECTION_INVALID");
const idValid = (id: unknown): id is string => typeof id === "string" && id.trim().length > 0 && id.length <= 512;
function one(items: SessionModelEntity[]): SessionModelEntity {
  if (items.length !== 1) throw invalid();
  return items[0]!;
}
function resolve(model: SessionModelSnapshot, ids: readonly string[]): Selection[] {
  const ui = useDocumentUiStore.getState();
  const owner = (featureId: string): { bodyId: string; featureId: string; instanceId?: string } => {
    const feature = one(model.features.filter(f => f.featureId === featureId));
    const instance = feature.type === "Instance";
    const sources = feature.dependsOn;
    if (instance && (!Array.isArray(sources) || sources.length !== 1 || !idValid(sources[0]))) throw invalid();
    const source = instance ? (sources as string[])[0]! : featureId;
    const body = one(model.bodies.filter(b => Array.isArray(b.history) && b.history.includes(source)));
    if (!idValid(body.bodyId)) throw invalid();
    return { bodyId: body.bodyId, featureId, ...(instance ? { instanceId: featureId } : {}) };
  };
  return ids.map(persistentId => {
    const cut = persistentId.indexOf(":");
    if (cut >= 0) {
      const featureId = persistentId.slice(0, cut), role = persistentId.slice(cut + 1);
      const owned = owner(featureId);
      const feature = one(model.features.filter(f => f.featureId === featureId));
      const body = one(model.bodies.filter(b => b.bodyId === owned.bodyId));
      if (feature.geometryCurrent === false || body.visible === false || (!owned.instanceId && body.tip !== featureId)) throw invalid();
      // Shared context is published only after syncFromCoreList hydrates meshes.
      // meshRevision itself is a refresh counter, not a document revision.
      const reconciled = useSharedTargetStore.getState().context;
      if (!reconciled || reconciled.sessionId !== model.sessionId || reconciled.documentId !== model.documentId || reconciled.revision !== model.revision) throw stale();
      const mesh = ui.meshes[featureId];
      if (!mesh || mesh.revision > model.revision) throw invalid();
      const kind = role.startsWith("edge.") ? "edge" : "face";
      const references = kind === "edge" ? mesh.edges.map(e => e.persistentEdgeId) : mesh.faces.map(f => f.persistentFaceId);
      // Native roles may be unqualified; another owner's qualified role is never a match.
      if (references.filter(id => id === persistentId || id === role).length !== 1) throw invalid();
      return { kind, persistentId, ...owned };
    }
    const sketches = model.sketches.filter(s => s.featureId === persistentId);
    const datums = (model.datums ?? []).filter(d => d.featureId === persistentId);
    const bodies = model.bodies.filter(b => b.bodyId === persistentId);
    const features = model.features.filter(f => f.featureId === persistentId);
    if (sketches.length) {
      one(sketches); if (datums.length || bodies.length || features.some(f => f.type !== "Sketch")) throw invalid();
      return { kind: "sketch", persistentId, featureId: persistentId };
    }
    if (datums.length) {
      const datum = one(datums);
      const kinds = { DatumPlane: "datumPlane", DatumAxis: "datumAxis", DatumPoint: "datumPoint" } as const;
      if (bodies.length || typeof datum.kind !== "string" || !Object.hasOwn(kinds, datum.kind)) throw invalid();
      return { kind: kinds[datum.kind as keyof typeof kinds], persistentId, featureId: persistentId };
    }
    if (bodies.length) {
      const body = one(bodies);
      if (!idValid(body.tip)) throw invalid();
      const owned = owner(body.tip);
      if (owned.bodyId !== persistentId || owned.instanceId) throw invalid();
      return { kind: "body", persistentId, ...owned };
    }
    const owned = owner(persistentId);
    return { kind: owned.instanceId ? "instance" : "body", persistentId, ...owned };
  });
}

export async function captureHermesReview(text: string, locale: Locale): Promise<HermesReview> {
  const before = useDocumentUiStore.getState();
  const ids = [...useSelectionStore.getState().selectedIds];
  const sharedBefore = useSharedTargetStore.getState().context;
  const sharedStamp = JSON.stringify(sharedBefore);
  if (!before.coreRunning || !before.documentId || !Number.isSafeInteger(before.revision) || before.revision < 0 || getLocale() !== locale) throw stale();
  if (!text.trim() || ids.length > 64 || ids.some(id => !idValid(id)) || new Set(ids).size !== ids.length) throw invalid();
  const model = await window.kreoda.sessionSnapshot();
  const after = useDocumentUiStore.getState();
  if (!after.coreRunning || after.documentId !== before.documentId || after.revision !== before.revision || after.epoch !== before.epoch ||
      after.connectionGeneration !== before.connectionGeneration || getLocale() !== locale || JSON.stringify(useSelectionStore.getState().selectedIds) !== JSON.stringify(ids) ||
      JSON.stringify(useSharedTargetStore.getState().context) !== sharedStamp || model.documentId !== before.documentId || model.revision !== before.revision ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(model.sessionId) ||
      (sharedBefore && (sharedBefore.sessionId !== model.sessionId || sharedBefore.documentId !== model.documentId || sharedBefore.revision !== model.revision)) ||
      (ids.some(id => id.includes(":")) && before.meshRevision !== after.meshRevision)) throw stale();
  const selections = resolve(model, ids).map(item => Object.freeze(item));
  for (const item of selections) if (!idValid(item.featureId) || (item.bodyId !== undefined && !idValid(item.bodyId)) || (item.instanceId !== undefined && !idValid(item.instanceId))) throw invalid();
  return Object.freeze({ text: text.trim(), locale, sessionId: model.sessionId, documentId: model.documentId, revision: model.revision,
    epoch: before.epoch, connectionGeneration: before.connectionGeneration, selectionIds: Object.freeze(ids), selections: Object.freeze(selections) });
}

export async function revalidateHermesReview(review: HermesReview): Promise<void> {
  const current = await captureHermesReview(review.text, review.locale);
  if (JSON.stringify(current) !== JSON.stringify(review)) throw stale();
}

export function buildHermesTurn(review: HermesReview, voiceRequestId: string): VoiceTurnParams {
  return { voiceRequestId, text: review.text, documentId: review.documentId, expectedRevision: review.revision,
    context: { voiceRequestId, sessionId: review.sessionId, documentId: review.documentId, revision: review.revision,
      project: "Kreoda", units: "mm", locale: review.locale, source: "desktop", selectionIds: [...review.selectionIds],
      ...(review.selections.length ? { selectionContext: { version: 2, selections: review.selections.map(s => ({ ...s })) } } : {}) } };
}
