import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CoreMeshData, SketchProjectionDefinition } from "@kreoda/protocol";
const mockCore = vi.hoisted(() => ({ documentId: "doc", requestMesh: vi.fn(), setSketchProjection: vi.fn() }));
vi.mock("../src/ipc/coreClient", () => ({ coreClient: mockCore }));
import { syncFromCoreList } from "../src/model/sync";
import { useDocumentUiStore } from "../src/stores";
import { SketchProjectionPanel } from "../src/components/workspace/SketchProjectionPanel";
import { setLocale } from "../src/i18n";

const feature = { featureId: "solid", type: "Box", paramsMm: [], dependsOn: [], refExtra: "", expressions: {}, geometryCurrent: true };
const target = { featureId: "target", planeKind: "XY", points: 0, lines: 0, circles: 0, constraints: 0,
  model: { points: [], lines: [], circles: [], arcs: [], constraints: [] } };
const mesh = { revision: 1, edges: [{ persistentEdgeId: "solid:edge-a" }] } as CoreMeshData;
beforeEach(() => {
  setLocale("en");
  useDocumentUiStore.getState().resetDocument("doc");
  useDocumentUiStore.getState().setFeatures([feature], 1);
  useDocumentUiStore.getState().setSketches([target], 1);
  useDocumentUiStore.getState().replaceAllMeshes({ solid: mesh }, 1);
  mockCore.requestMesh.mockReset();
  mockCore.setSketchProjection.mockReset().mockRejectedValue(new Error("offline"));
});
afterEach(cleanup);

it("keeps semantic edge and shape sources after an unrelated delta retains the mesh", async () => {
  await syncFromCoreList([feature], 2, [target], []);
  expect(useDocumentUiStore.getState().meshes.solid).toBe(mesh);
  render(<SketchProjectionPanel sketchId="target" />);
  const source = screen.getByLabelText("Projection source");
  expect(source.querySelector('option[value="edge:solid:edge-a"]')).not.toBeNull();
  fireEvent.change(screen.getByLabelText("Projection operation"), { target: { value: "silhouette" } });
  expect(source.querySelector('option[value="shape:solid"]')).not.toBeNull();
  expect(mockCore.requestMesh).not.toHaveBeenCalled();
});

it("withdraws changed sources while replacement mesh is pending, then restores them", async () => {
  let release!: (value: CoreMeshData) => void;
  mockCore.requestMesh.mockReturnValue(new Promise(resolve => { release = resolve; }));
  const pending = syncFromCoreList([feature], 2, [target], ["solid"]);
  expect(useDocumentUiStore.getState().meshes.solid).toBeUndefined();
  release({ ...mesh, revision: 2 });
  await pending;
  expect(useDocumentUiStore.getState().meshes.solid?.revision).toBe(2);
});

it("never offers unavailable geometry even when an older mesh existed", async () => {
  await syncFromCoreList([{ ...feature, geometryCurrent: false, status: "unavailable" }], 2, [target], []);
  render(<SketchProjectionPanel sketchId="target" />);
  expect(screen.getByLabelText("Projection source").querySelectorAll("option")).toHaveLength(1);
});

it("repairs a broken multi-source group without replacing its original bindings", async () => {
  const definition: SketchProjectionDefinition = { version: 1, operation: "projectEdges", sources: [
    { type: "edge" as const, featureId: "missing", persistentEdgeId: "missing:edge-1" },
    { type: "shape" as const, featureId: "other" },
  ] };
  useDocumentUiStore.getState().setSketches([{ ...target, projectionGroups: [{
    groupId: "group-broken", definition, sourceFeatureIds: ["missing", "other"],
    status: "broken" as const, error: "source unavailable", blockingSourceIds: ["missing"], generation: 1,
  }] }], 1);
  render(<SketchProjectionPanel sketchId="target" />);
  fireEvent.change(screen.getByLabelText("Projection group"), { target: { value: "group-broken" } });
  expect(screen.getByLabelText("Projection source").querySelector('option[value="edge:missing:edge-1"]')).toBeNull();
  fireEvent.click(screen.getByText("Repair selected group"));
  await waitFor(() => expect(mockCore.setSketchProjection).toHaveBeenCalledWith("target", "group-broken", definition));
});

it("replaces a group source only through the explicit replacement action", async () => {
  const definition: SketchProjectionDefinition = { version: 1, operation: "projectEdges", sources: [
    { type: "edge", featureId: "missing", persistentEdgeId: "missing:edge-1" },
    { type: "shape", featureId: "other" },
  ] };
  useDocumentUiStore.getState().setSketches([{ ...target, projectionGroups: [{
    groupId: "group-broken", definition, sourceFeatureIds: ["missing", "other"],
    status: "broken" as const, error: "source unavailable", blockingSourceIds: ["missing"], generation: 1,
  }] }], 1);
  render(<SketchProjectionPanel sketchId="target" />);
  const replace = screen.getByText("Replace group source") as HTMLButtonElement;
  expect(replace.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Projection group"), { target: { value: "group-broken" } });
  expect(replace.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Projection source"), { target: { value: "edge:solid:edge-a" } });
  fireEvent.click(screen.getByText("Repair selected group"));
  await waitFor(() => expect(mockCore.setSketchProjection).toHaveBeenCalledWith("target", "group-broken", definition));
  await waitFor(() => expect(replace.disabled).toBe(false));
  mockCore.setSketchProjection.mockClear();
  fireEvent.click(replace);
  await waitFor(() => expect(mockCore.setSketchProjection).toHaveBeenCalledExactlyOnceWith("target", "group-broken", {
    version: 1, operation: "projectEdges", sources: [{ type: "edge", featureId: "solid", persistentEdgeId: "solid:edge-a" }],
  }));
  expect(definition.sources).toHaveLength(2);
});
