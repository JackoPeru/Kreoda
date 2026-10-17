import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CoreMeshData } from "@kreoda/protocol";
const mockCore = vi.hoisted(() => ({ documentId: "doc", requestMesh: vi.fn() }));
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
