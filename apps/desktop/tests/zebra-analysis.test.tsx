import { afterEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { CoreMeshData } from "@kreoda/protocol";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useZebraStore } from "../src/analysis/zebra";
import { useDocumentUiStore } from "../src/stores";
import { ZebraAnalysisPanel } from "../src/components/workspace/ZebraAnalysisPanel";

vi.mock("three", async original => ({
  ...await original<typeof import("three")>(),
  WebGLRenderer: class {
    domElement = document.createElement("canvas");
    render() {} setPixelRatio() {} setSize() {} dispose() {}
  },
}));
import { CadViewport } from "../src/viewport/CadViewport";

afterEach(() => { cleanup(); useDocumentUiStore.getState().resetDocument("zebra-test"); vi.unstubAllGlobals(); });

it("validates display settings and clears them on document replacement without changing CAD state", () => {
  const before = useDocumentUiStore.getState();
  useZebraStore.getState().update({ enabled: true, bands: 24, angleDeg: 75 });
  for (const patch of [{ bands: 3 }, { bands: 49 }, { bands: 4.5 }, { angleDeg: NaN }, { angleDeg: 181 }])
    useZebraStore.getState().update(patch);
  expect(useZebraStore.getState()).toMatchObject({ enabled: true, bands: 24, angleDeg: 75 });
  expect(useDocumentUiStore.getState()).toBe(before);
  useDocumentUiStore.getState().resetDocument("different-document");
  expect(useZebraStore.getState()).toMatchObject({ enabled: false, bands: 16, angleDeg: 0 });
});

it("keeps the empty-document control accessible and permits disabling an existing analysis", () => {
  render(<ZebraAnalysisPanel />);
  expect((screen.getByRole("checkbox", { name: "Analisi zebra" }) as HTMLInputElement).disabled).toBe(true);
  cleanup();
  useZebraStore.getState().update({ enabled: true });
  render(<ZebraAnalysisPanel />);
  fireEvent.change(screen.getByLabelText("Densità bande zebra"), { target: { value: "32" } });
  fireEvent.change(screen.getByLabelText("Orientamento zebra"), { target: { value: "90" } });
  expect(useZebraStore.getState()).toMatchObject({ bands: 32, angleDeg: 90 });
  fireEvent.click(screen.getByRole("checkbox", { name: "Analisi zebra" }));
  expect(useZebraStore.getState().enabled).toBe(false);
});

it("applies reversible reflection stripes to current and future CAD materials without changing mesh or picking", () => {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const viewport = new CadViewport(document.createElement("div"), { onHover() {}, onSelect() {} });
  const mesh: CoreMeshData = {
    revision: 1, volumeMm3: 0, bboxMm: [0,0,0,10,10,0], triangleCount: 1,
    positions: new Float32Array([0,0,0,10,0,0,0,10,0]),
    normals: new Float32Array([0,0,1,0,0,1,0,0,1]), indices: new Uint32Array([0,1,2]),
    faces: [{ persistentFaceId: "sheet:face", triangleStart: 0, triangleCount: 1 }],
    edges: [], edgeVertices: new Float32Array(),
  };
  const entries = (viewport as unknown as { bodies: Map<string, { mesh: THREE.Mesh }> }).bodies;
  try {
    viewport.syncMeshes({ sheet: mesh });
    const geometry = entries.get("sheet")!.mesh.geometry;
    const normals = [...mesh.normals];
    viewport.setZebra({ enabled: true, bands: 16, angleDeg: 30 });
    viewport.setSelected(["sheet:face"]);
    expect(geometry.groups[0]!.materialIndex).toBe(2);
    const material = (entries.get("sheet")!.mesh.material as THREE.MeshStandardMaterial[])[0]!;
    const shader = { ...THREE.ShaderLib.standard, uniforms: {} };
    material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain("reflect(");
    expect(shader.uniforms).toMatchObject({ zebraEnabled: { value: 1 }, zebraBands: { value: 16 } });
    viewport.setSection({ normal: [0,0,1], offsetMm: 0, inverted: false });
    expect(material.clippingPlanes).toHaveLength(1);
    viewport.syncMeshes({ sheet: mesh, second: { ...mesh, revision: 2 } });
    expect(entries.get("sheet")!.mesh.geometry).toBe(geometry);
    expect([...mesh.normals]).toEqual(normals);
    const next = (entries.get("second")!.mesh.material as THREE.MeshStandardMaterial[])[0]!;
    const nextShader = { ...THREE.ShaderLib.standard, uniforms: {} };
    next.onBeforeCompile(nextShader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(nextShader.uniforms).toMatchObject({ zebraEnabled: { value: 1 } });
    viewport.setZebra({ enabled: false, bands: 16, angleDeg: 30 });
    expect(shader.uniforms).toMatchObject({ zebraEnabled: { value: 0 } });
    expect(entries.get("sheet")!.mesh.geometry).toBe(geometry);
  } finally { viewport.dispose(); }
});
