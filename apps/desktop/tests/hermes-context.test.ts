import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreMeshData, SessionModelSnapshot } from "@kreoda/protocol";
import type { KreodaApi } from "../electron/preload";
import { useDocumentUiStore, useSelectionStore } from "../src/stores";
import { useSharedTargetStore } from "../src/model/shared-targets";
import { captureHermesReview, revalidateHermesReview, buildHermesTurn } from "../src/intent/hermes";
import { setLocale } from "../src/i18n";
const sessionId = "a3dc49de-24bf-4b91-b356-54cc2dd06741";
let model: SessionModelSnapshot;
const mesh = () => ({ revision: 1, faces: [{ persistentFaceId: "top" }], edges: [{ persistentEdgeId: "edge.0" }] }) as unknown as CoreMeshData;
beforeEach(() => {
  setLocale("en");
  model = { sessionId, documentId: "doc", revision: 4,
    features: [{ featureId: "base", type: "Box" }, { featureId: "tip", type: "Hole" }, { featureId: "inst", type: "Instance", dependsOn: ["tip"] }],
    bodies: [{ bodyId: "body", tip: "tip", history: ["base", "tip"], visible: true }],
    sketches: [{ featureId: "sketch" }], datums: [{ featureId: "plane", kind: "DatumPlane" }] };
  useDocumentUiStore.setState({ documentId: "doc", revision: 4, epoch: 2, connectionGeneration: 3, coreRunning: true, meshRevision: 9, meshes: { tip: mesh(), inst: mesh() } });
  useSelectionStore.setState({ selectedIds: [] }); useSharedTargetStore.getState().setContext(model);
  window.kreoda = { sessionSnapshot: vi.fn(async () => structuredClone(model)) } as unknown as KreodaApi;
});
describe("Hermes authoritative selection context", () => {
  it("empty selection omits semantic context and preserves exact fence", async () => {
    const r = await captureHermesReview("make a bracket", "en");
    expect(buildHermesTurn(r, "flow-1")).toMatchObject({ text: "make a bracket", documentId: "doc", expectedRevision: 4, context: { sessionId, revision: 4, voiceRequestId: "flow-1", selectionIds: [], units: "mm", locale: "en", source: "desktop" } });
    expect(buildHermesTurn(r, "flow-1").context.selectionContext).toBeUndefined();
  });
  it("maps mixed body/history/face/edge/instance/datum/sketch in exact selection order", async () => {
    useSelectionStore.setState({ selectedIds: ["body", "base", "tip:top", "tip:edge.0", "inst", "plane", "sketch"] });
    const r = await captureHermesReview("inspect selection", "en");
    expect(r.selections).toEqual([
      { kind: "body", persistentId: "body", bodyId: "body", featureId: "tip" },
      { kind: "body", persistentId: "base", bodyId: "body", featureId: "base" },
      { kind: "face", persistentId: "tip:top", bodyId: "body", featureId: "tip" },
      { kind: "edge", persistentId: "tip:edge.0", bodyId: "body", featureId: "tip" },
      { kind: "instance", persistentId: "inst", bodyId: "body", featureId: "inst", instanceId: "inst" },
      { kind: "datumPlane", persistentId: "plane", featureId: "plane" },
      { kind: "sketch", persistentId: "sketch", featureId: "sketch" },
    ]);
    await expect(revalidateHermesReview(r)).resolves.toBeUndefined();
  });
  it.each(["unknown", "base:top", "tip:missing", "foreign:top", " ", "x".repeat(513)])("rejects invalid or stale selection %s", async id => {
    useSelectionStore.setState({ selectedIds: [id] }); await expect(captureHermesReview("inspect", "en")).rejects.toThrow();
  });
  it("accepts equivalent LOD refresh and unchanged older per-body mesh at reconciled revision", async () => {
    useSelectionStore.setState({ selectedIds: ["tip:top"] }); const r = await captureHermesReview("inspect", "en");
    useDocumentUiStore.setState({ meshes: { tip: mesh() }, meshRevision: 10 });
    await expect(revalidateHermesReview(r)).resolves.toBeUndefined();
  });
  it("rejects ambiguous topology and nonunique source bodies", async () => {
    const m = mesh(); m.faces.push({ persistentFaceId: "top", triangleStart: 0, triangleCount: 1 });
    useDocumentUiStore.setState({ meshes: { tip: m } }); useSelectionStore.setState({ selectedIds: ["tip:top"] });
    await expect(captureHermesReview("inspect", "en")).rejects.toThrow();
    model.bodies.push({ bodyId: "other", tip: "tip", history: ["tip"] }); useSelectionStore.setState({ selectedIds: ["inst"] });
    await expect(captureHermesReview("inspect", "en")).rejects.toThrow();
  });
  it("rejects duplicates and more than 64 selections without truncating", async () => {
    useSelectionStore.setState({ selectedIds: ["body", "body"] }); await expect(captureHermesReview("inspect", "en")).rejects.toThrow();
    useSelectionStore.setState({ selectedIds: Array.from({ length: 65 }, (_, i) => String(i)) }); await expect(captureHermesReview("inspect", "en")).rejects.toThrow();
  });
  it("accepts all 64 selections and a 512-character canonical ID", async () => {
    const ids = Array.from({ length: 64 }, (_, i) => i === 0 ? "s".repeat(512) : `sketch-${i}`);
    model.sketches = ids.map(featureId => ({ featureId })); useSelectionStore.setState({ selectedIds: ids });
    const review = await captureHermesReview("inspect", "en"); expect(review.selectionIds).toEqual(ids); expect(review.selections).toHaveLength(64);
  });
  it.each(["documentId", "coreRunning"] as const)("rejects changed %s before Send", async key => {
    const r = await captureHermesReview("inspect", "en");
    useDocumentUiStore.setState(key === "coreRunning" ? { coreRunning: false } : { documentId: "other" });
    await expect(revalidateHermesReview(r)).rejects.toThrow();
  });
  it("rejects selection reorder and changed semantic identity before Send", async () => {
    useSelectionStore.setState({ selectedIds: ["body", "sketch"] }); const r = await captureHermesReview("inspect", "en");
    useSelectionStore.setState({ selectedIds: ["sketch", "body"] }); await expect(revalidateHermesReview(r)).rejects.toThrow();
    useSelectionStore.setState({ selectedIds: ["body", "sketch"] }); model.bodies[0]!.tip = "base";
    await expect(revalidateHermesReview(r)).rejects.toThrow();
  });
  it.each(["revision", "epoch", "connectionGeneration"] as const)("rejects %s change while awaiting snapshot", async key => {
    window.kreoda.sessionSnapshot = vi.fn(async () => { const state = useDocumentUiStore.getState(); useDocumentUiStore.setState({ [key]: state[key] + 1 }); return model; });
    await expect(captureHermesReview("inspect", "en")).rejects.toThrow();
  });
  it("rejects session switch, locale change and unreconciled topology before Send", async () => {
    const r = await captureHermesReview("inspect", "en"); model.sessionId = "54a0b2a4-3815-4f23-9a4a-25b242e9a151";
    await expect(revalidateHermesReview(r)).rejects.toThrow(); model.sessionId = sessionId;
    setLocale("it"); await expect(revalidateHermesReview(r)).rejects.toThrow(); setLocale("en");
    useSelectionStore.setState({ selectedIds: ["tip:top"] }); useSharedTargetStore.getState().reset();
    await expect(captureHermesReview("inspect", "en")).rejects.toThrow();
  });
});
