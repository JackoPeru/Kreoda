import { afterEach, expect, it, vi } from "vitest";

const draws = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("three", async (original) => ({
  ...await original<typeof import("three")>(),
  WebGLRenderer: class {
    domElement = document.createElement("canvas");
    render = draws.render;
    setPixelRatio() {}
    setSize() {}
    dispose() {}
  },
}));
import { CadViewport } from "../src/viewport/CadViewport";
import * as THREE from "three";
import type { CoreMeshData } from "@kreoda/protocol";

afterEach(() => vi.unstubAllGlobals());

it("keeps unchanged geometry and disposes only replaced or removed meshes", () => {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const viewport = new CadViewport(document.createElement("div"), { onHover: () => {}, onSelect: () => {} });
  const mesh = (id: string, revision: number): CoreMeshData => ({
    revision, volumeMm3: 0, bboxMm: [0, 0, 0, 10, 10, 0], triangleCount: 1,
    positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    faces: [{ persistentFaceId: id + ":face", triangleStart: 0, triangleCount: 1 }],
    edges: [], edgeVertices: new Float32Array(),
  });
  const sceneBodies = (viewport as unknown as { bodies: Map<string, { mesh: THREE.Mesh }> }).bodies;
  try {
    const a = mesh("a", 1), b = mesh("b", 1);
    viewport.syncMeshes({ a, b });
    const aGeometry = sceneBodies.get("a")!.mesh.geometry;
    const bGeometry = sceneBodies.get("b")!.mesh.geometry;
    const aDisposed = vi.fn(), bDisposed = vi.fn();
    aGeometry.addEventListener("dispose", aDisposed);
    bGeometry.addEventListener("dispose", bDisposed);
    viewport.syncMeshes({ a: mesh("a", 2), b });
    expect(sceneBodies.get("b")!.mesh.geometry).toBe(bGeometry);
    expect(bDisposed).not.toHaveBeenCalled();
    expect(aDisposed).toHaveBeenCalledTimes(1);
    expect(sceneBodies.get("a")!.mesh.geometry).not.toBe(aGeometry);
    viewport.syncMeshes({ b });
    expect(sceneBodies.get("b")!.mesh.geometry).toBe(bGeometry);
    expect(bDisposed).not.toHaveBeenCalled();
    viewport.syncMeshes({});
    expect(bDisposed).toHaveBeenCalledTimes(1);
  } finally { viewport.dispose(); }
});

it("redraws after camera zoom even when hovering empty space leaves selection unchanged", () => {
  let frame: globalThis.FrameRequestCallback = () => {};
  vi.stubGlobal("requestAnimationFrame", (callback: globalThis.FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  draws.render.mockClear();
  const container = document.createElement("div");
  const viewport = new CadViewport(container, { onHover: () => {}, onSelect: () => {} });
  try {
    expect(draws.render).toHaveBeenCalledTimes(1);
    frame(0);
    expect(draws.render).toHaveBeenCalledTimes(1);
    container.querySelector("canvas")!.dispatchEvent(new WheelEvent("wheel", { deltaY: 60 }));
    frame(16);
    expect(draws.render).toHaveBeenCalledTimes(2);
    frame(32);
    expect(draws.render).toHaveBeenCalledTimes(2);
  } finally {
    viewport.dispose();
  }
});
