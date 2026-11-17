import { afterEach, expect, it, vi } from "vitest";

const draws = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("three", async original => ({
  ...await original<typeof import("three")>(),
  WebGLRenderer: class {
    domElement = document.createElement("canvas");
    localClippingEnabled = false;
    render = draws.render;
    setPixelRatio() {}
    setSize() {}
    dispose() {}
  },
}));

import * as THREE from "three";
import type { CoreMeshData } from "@kreoda/protocol";
import { CadViewport } from "../src/viewport/CadViewport";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeViewport() {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const onSelect = vi.fn();
  const viewport = new CadViewport(document.createElement("div"), { onHover: vi.fn(), onSelect });
  return { viewport, onSelect };
}

function edgeMesh(): CoreMeshData {
  return {
    revision: 1, volumeMm3: 0, bboxMm: [0, 0, 0, 10, 10, 1], triangleCount: 1,
    positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    faces: [{ persistentFaceId: "surface-a:face-1", triangleStart: 0, triangleCount: 1 }],
    edges: [
      { persistentEdgeId: "surface-a:edge-0", vertexStart: 0, vertexCount: 2 },
      { persistentEdgeId: "surface-a:edge-1", vertexStart: 2, vertexCount: 2 },
    ],
    edgeVertices: new Float32Array([0, 0, 0, 10, 0, 0, 0, 1, 0, 10, 1, 0]),
  };
}

it("captures only a left click that survives the camera gate and leaves wrong targets pending", async () => {
  const { viewport, onSelect } = makeViewport();
  try {
    const pickFaceAt = vi.spyOn(viewport, "pickFaceAt");
    const controls = (viewport as unknown as { controls: { consumeClick: () => boolean } }).controls;
    const consumeClick = vi.spyOn(controls, "consumeClick");
    const pending = viewport.beginSurfacePointPick("surface-a");
    let settled = false;
    void pending.then(() => { settled = true; });
    const canvas = (viewport as unknown as { renderer: { domElement: HTMLCanvasElement } }).renderer.domElement;

    canvas.dispatchEvent(new MouseEvent("click", { button: 2 }));
    expect(consumeClick).not.toHaveBeenCalled();
    consumeClick.mockReturnValueOnce(true);
    canvas.dispatchEvent(new MouseEvent("click", { button: 0 }));
    expect(pickFaceAt).not.toHaveBeenCalled();
    expect(settled).toBe(false);

    consumeClick.mockReturnValue(false);
    pickFaceAt.mockReturnValueOnce(null).mockReturnValueOnce({
      featureId: "surface-b", faceId: "surface-b:face", normal: new THREE.Vector3(0, 0, 1), point: new THREE.Vector3(1, 2, 3),
    });
    canvas.dispatchEvent(new MouseEvent("click", { button: 0 }));
    canvas.dispatchEvent(new MouseEvent("click", { button: 0 }));
    expect(settled).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();

    pickFaceAt.mockReturnValueOnce({
      featureId: "surface-a", faceId: "surface-a:face-1", normal: new THREE.Vector3(0, 0, 1), point: new THREE.Vector3(5, 6, 7),
    });
    canvas.dispatchEvent(new MouseEvent("click", { button: 0 }));
    await expect(pending).resolves.toEqual({
      featureId: "surface-a", persistentFaceId: "surface-a:face-1", pointMm: [5, 6, 7],
    });
    expect(onSelect).not.toHaveBeenCalled();
  } finally {
    viewport.dispose();
  }
});

it("uses the semantic edge owner mapping and existing section-aware edge raycast", () => {
  const { viewport } = makeViewport();
  try {
    viewport.syncMeshes({ "surface-a": edgeMesh() });
    const state = viewport as unknown as {
      bodies: Map<string, { edgeLines: THREE.LineSegments }>;
      raycaster: THREE.Raycaster;
    };
    const edgeLines = state.bodies.get("surface-a")!.edgeLines;
    vi.spyOn(state.raycaster, "setFromCamera").mockImplementation(() => {});
    const intersections = vi.spyOn(state.raycaster, "intersectObjects").mockImplementation(objects => {
      if (objects[0] === edgeLines) return [{
        distance: 1, point: new THREE.Vector3(1, 1, 0), object: edgeLines, index: 2,
      } as THREE.Intersection<THREE.Object3D>];
      return [];
    });

    expect(viewport.pickEdgeAt(10, 10)).toEqual({ featureId: "surface-a", persistentEdgeId: "surface-a:edge-1" });
    expect(intersections).toHaveBeenCalled();
    viewport.setSection({ normal: [0, 0, 1], offsetMm: 5, inverted: false });
    expect(viewport.pickEdgeAt(10, 10)).toBeNull();
  } finally {
    viewport.dispose();
  }
});

it("resolves pending capture on reference-measure takeover and viewport disposal", async () => {
  const first = makeViewport().viewport;
  const capture = first.beginSurfaceEdgePick("surface-a");
  const reference = first.beginReferenceMeasure("missing-plane");
  await expect(capture).resolves.toBeNull();
  await expect(reference).resolves.toBeNull();
  first.dispose();

  const second = makeViewport().viewport;
  const pending = second.beginSurfacePointPick("surface-a");
  second.dispose();
  await expect(pending).resolves.toBeNull();
});

