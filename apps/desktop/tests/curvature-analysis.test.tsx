import { afterEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { CoreMeshData } from "@kreoda/protocol";
vi.mock("three", async original => ({
  ...await original<typeof import("three")>(),
  WebGLRenderer: class {
    domElement = document.createElement("canvas"); localClippingEnabled = false;
    setPixelRatio() {} setSize() {} render() {} dispose() {}
  },
}));
import { CadViewport } from "../src/viewport/CadViewport";
import { useZebraStore } from "../src/analysis/zebra";
import { useDocumentUiStore } from "../src/stores";

afterEach(() => { useDocumentUiStore.getState().resetDocument("curvature-test"); vi.unstubAllGlobals(); });

it("keeps curvature and zebra mutually exclusive and resets presentation on document replacement", () => {
  const before = useDocumentUiStore.getState();
  useZebraStore.getState().setCurvature({ enabled: true, maximumPerMm: .25 });
  expect(useZebraStore.getState()).toMatchObject({ enabled: false, curvature: { enabled: true, maximumPerMm: .25 } });
  for(const maximumPerMm of [0, -1, NaN, Infinity, 1e300, 1e-300])
    useZebraStore.getState().setCurvature({ maximumPerMm });
  expect(useZebraStore.getState().curvature.maximumPerMm).toBe(.25);
  useZebraStore.getState().update({ enabled: true });
  expect(useZebraStore.getState()).toMatchObject({ enabled: true, curvature: { enabled: false, maximumPerMm: .25 } });
  expect(useDocumentUiStore.getState()).toBe(before);
  useZebraStore.getState().setCurvature({ enabled: true });
  expect(useZebraStore.getState().enabled).toBe(false);
  useDocumentUiStore.getState().resetDocument("curvature-next");
  expect(useZebraStore.getState().curvature).toEqual({ enabled: false, maximumPerMm: .1 });
});

it("colors native curvature without replacing geometry, picking or section clipping, including future meshes", () => {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const viewport = new CadViewport(document.createElement("div"), { onHover() {}, onSelect() {} });
  const source: CoreMeshData = {
    revision: 7, volumeMm3: 0, bboxMm: [0,0,0,10,10,0], triangleCount: 1,
    positions: new Float32Array([0,0,0,10,0,0,0,10,0]),
    normals: new Float32Array([0,0,1,0,0,1,0,0,1]), indices: new Uint32Array([0,1,2]),
    faces: [{ persistentFaceId: "sheet:face", triangleStart: 0, triangleCount: 1 }],
    edges: [], edgeVertices: new Float32Array(), curvatureMaxAbsPerMm: new Float32Array([0,.125,-1]),
  };
  const entries = (viewport as unknown as { bodies: Map<string, { mesh: THREE.Mesh }> }).bodies;
  try {
    viewport.syncMeshes({ sheet: source });
    const geometry = entries.get("sheet")!.mesh.geometry;
    viewport.setCurvature({ enabled: true, maximumPerMm: .25 });
    expect([...geometry.getAttribute("kreodaCurvature").array]).toEqual([0,.125,-1]);
    viewport.setSelected(["sheet:face"]);
    expect(geometry.groups[0]!.materialIndex).toBe(2);
    viewport.setSection({ normal: [0,0,1], offsetMm: 0, inverted: false });
    const material = (entries.get("sheet")!.mesh.material as THREE.MeshStandardMaterial[])[0]!;
    const shader = { ...THREE.ShaderLib.standard, uniforms: {} };
    material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.uniforms).toMatchObject({ curvatureEnabled: { value: 1 }, curvatureMaximumPerMm: { value: .25 } });
    expect(shader.vertexShader).toContain("kreodaCurvature");
    expect(shader.fragmentShader).toContain("vKreodaCurvature");
    expect(material.clippingPlanes).toHaveLength(1);
    viewport.syncMeshes({ sheet: source, future: { ...source, curvatureMaxAbsPerMm: undefined } });
    const future = entries.get("future")!.mesh;
    expect([...future.geometry.getAttribute("kreodaCurvature").array]).toEqual([-1,-1,-1]);
    viewport.setCurvature({ enabled: true, maximumPerMm: NaN });
    expect(shader.uniforms).toMatchObject({ curvatureMaximumPerMm: { value: .25 } });
    viewport.setCurvature({ enabled: false, maximumPerMm: .25 });
    expect(shader.uniforms).toMatchObject({ curvatureEnabled: { value: 0 } });
    expect(entries.get("sheet")!.mesh.geometry).toBe(geometry);
    expect(source.curvatureMaxAbsPerMm).toEqual(new Float32Array([0,.125,-1]));
    expect(source.revision).toBe(7);
  } finally { viewport.dispose(); }
});
