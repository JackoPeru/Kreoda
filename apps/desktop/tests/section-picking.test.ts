import { afterEach, expect, it, vi } from "vitest";

const draws = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("three", async (original) => ({
  ...await original<typeof import("three")>(),
  WebGLRenderer: class {
    domElement = document.createElement("canvas");
    info = { render: { triangles: 0 }, memory: { geometries: 0, textures: 0 } };
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
import { createSectionPlane } from "../src/section/plane";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function nativeMesh(): CoreMeshData {
  return {
    revision: 1,
    volumeMm3: 1,
    bboxMm: [-1, -1, -1, 1, 1, 1],
    triangleCount: 2,
    positions: new Float32Array([0, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, -1, 1, 0, -1, 0, 1, -1]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1]),
    indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    faces: [
      { persistentFaceId: "box:visible-face", triangleStart: 0, triangleCount: 1 },
      { persistentFaceId: "box:hidden-face", triangleStart: 1, triangleCount: 1 },
    ],
    edges: [
      { persistentEdgeId: "box:hidden-edge", vertexStart: 0, vertexCount: 2 },
      { persistentEdgeId: "box:visible-edge", vertexStart: 2, vertexCount: 2 },
    ],
    edgeVertices: new Float32Array([0, 0, -1, 1, 0, -1, 0, 0, 1, 1, 0, 1]),
  };
}

function closedCubeMesh(revision = 1): CoreMeshData {
  return {
    revision,
    volumeMm3: 8,
    bboxMm: [-1, -1, -1, 1, 1, 1],
    triangleCount: 12,
    positions: new Float32Array([
      -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1,
      -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
    ]),
    normals: new Float32Array(24),
    indices: new Uint32Array([
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
      0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5,
      2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
    ]),
    faces: [{ persistentFaceId: "cube:surface", triangleStart: 0, triangleCount: 12 }],
    edges: [{ persistentEdgeId: "cube:edge", vertexStart: 0, vertexCount: 2 }],
    edgeVertices: new Float32Array([-1, -1, -1, 1, -1, 1]),
  };
}

function intersection(
  object: THREE.Object3D,
  z: number,
  faceIndex: number,
  index = 0,
): THREE.Intersection<THREE.Object3D> {
  return {
    distance: Math.abs(z),
    point: new THREE.Vector3(0.25, 0.25, z),
    object,
    faceIndex,
    face: { a: 0, b: 1, c: 2, normal: new THREE.Vector3(0, 0, 1), materialIndex: 0 },
    index,
  };
}

function makeViewport() {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const onSelect = vi.fn();
  const viewport = new CadViewport(document.createElement("div"), { onHover: vi.fn(), onSelect });
  viewport.syncMeshes({ box: nativeMesh() });
  return { viewport, onSelect };
}

it("keeps a tangent native face selectable beside a crossing solid in the same mesh", () => {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const onSelect = vi.fn();
  const viewport = new CadViewport(document.createElement("div"), { onHover: vi.fn(), onSelect });
  const cube = closedCubeMesh();
  const tangent = [...cube.positions].map((value, i) => i % 3 === 0 ? value + 4 : i % 3 === 2 ? value - 1 : value);
  const mesh: CoreMeshData = { ...cube,
    positions: new Float32Array([...cube.positions, ...tangent]),
    normals: new Float32Array(48),
    indices: new Uint32Array([...cube.indices, ...[...cube.indices].map(index => index + 8)]),
    faces: [
      { persistentFaceId: "compound:crossing-native", triangleStart: 0, triangleCount: 12 },
      { persistentFaceId: "compound:tangent-native", triangleStart: 12, triangleCount: 12 },
    ],
    triangleCount: 24, volumeMm3: 16, bboxMm: [-1, -1, -2, 5, 1, 1],
  };
  try {
    viewport.syncMeshes({ compound: mesh });
    viewport.setPickMode("face");
    viewport.setSection(createSectionPlane([0, 0, 1], 0, true));
    const state = viewport as unknown as { raycaster: THREE.Raycaster; bodies: Map<string, { mesh: THREE.Mesh; sectionCap: THREE.Mesh }> };
    const entry = state.bodies.get("compound")!;
    entry.mesh.updateMatrixWorld(true);
    entry.sectionCap.updateMatrixWorld(true);
    state.raycaster.ray.set(new THREE.Vector3(4, 0, 2), new THREE.Vector3(0, 0, -1));
    vi.spyOn(state.raycaster, "setFromCamera").mockImplementation(() => {
      state.raycaster.ray.set(new THREE.Vector3(4, 0, 2), new THREE.Vector3(0, 0, -1));
    });
    expect(state.raycaster.intersectObject(entry.sectionCap)).toHaveLength(0);
    const pick = (viewport as unknown as { pick: (event: MouseEvent, commit: boolean) => void }).pick;
    pick.call(viewport, { clientX: 0, clientY: 0, ctrlKey: false, metaKey: false } as MouseEvent, true);
    expect(onSelect).toHaveBeenCalledWith("compound:tangent-native", false);
  } finally { viewport.dispose(); }
});

it("skips nearer hidden native face hits and selects nearest visible persistent face", () => {
  const { viewport, onSelect } = makeViewport();
  try {
    viewport.setPickMode("face");
    viewport.setSection(createSectionPlane([0, 0, 1], 0));
    const entry = (viewport as unknown as { bodies: Map<string, { mesh: THREE.Mesh }> }).bodies.get("box")!;
    const hits = [intersection(entry.mesh, -1, 1), intersection(entry.mesh, 1, 0)];
    const raycaster = (viewport as unknown as { raycaster: THREE.Raycaster }).raycaster;
    vi.spyOn(raycaster, "intersectObjects").mockReturnValue(hits);
    (viewport as unknown as { pick: (event: MouseEvent, commit: boolean) => void }).pick(
      { clientX: 0, clientY: 0, ctrlKey: false, metaKey: false } as MouseEvent,
      true,
    );
    expect(onSelect).toHaveBeenCalledWith("box:visible-face", false);
  } finally {
    viewport.dispose();
  }
});

it("does not let a crossing edge pick from its clipped-away segment", () => {
  const { viewport, onSelect } = makeViewport();
  try {
    viewport.setPickMode("edge");
    viewport.setSection(createSectionPlane([0, 0, 1], 0));
    const entry = (viewport as unknown as { bodies: Map<string, { edgeLines: THREE.LineSegments }> }).bodies.get("box")!;
    const hits = [intersection(entry.edgeLines, -0.25, -1, 0), intersection(entry.edgeLines, 0.25, -1, 2)];
    const raycaster = (viewport as unknown as { raycaster: THREE.Raycaster }).raycaster;
    vi.spyOn(raycaster, "intersectObjects").mockReturnValue(hits);
    (viewport as unknown as { pick: (event: MouseEvent, commit: boolean) => void }).pick(
      { clientX: 0, clientY: 0, ctrlKey: false, metaKey: false } as MouseEvent,
      true,
    );
    expect(onSelect).toHaveBeenCalledWith("box:visible-edge", false);
  } finally {
    viewport.dispose();
  }
});

it("skips an edge behind a retained wall and still picks an exposed boundary edge", () => {
  const { viewport, onSelect } = makeViewport();
  try {
    viewport.setPickMode("edge");
    viewport.setSection(createSectionPlane([0, 0, 1], 0));
    const entry = (viewport as unknown as {
      bodies: Map<string, { mesh: THREE.Mesh; edgeLines: THREE.LineSegments }>;
    }).bodies.get("box")!;
    const raycaster = (viewport as unknown as { raycaster: THREE.Raycaster }).raycaster;
    const edge = intersection(entry.edgeLines, 2, -1, 2);
    vi.spyOn(raycaster, "setFromCamera").mockImplementation(() => {
      raycaster.ray.set(new THREE.Vector3(0.25, 0.25, 0), new THREE.Vector3(0, 0, 1));
    });
    let wallDistance = 1;
    vi.spyOn(raycaster, "intersectObjects").mockImplementation((objects) => {
      if (objects.includes(entry.edgeLines)) return [edge];
      const wall = intersection(entry.mesh, 1, 0);
      wall.distance = wallDistance;
      return objects.includes(entry.mesh) ? [wall] : [];
    });
    const pick = (viewport as unknown as { pick: (event: MouseEvent, commit: boolean) => void }).pick;
    const event = { clientX: 0, clientY: 0, ctrlKey: false, metaKey: false } as MouseEvent;
    pick.call(viewport, event, true);
    expect(onSelect).not.toHaveBeenCalled();
    viewport.setSection(null);
    pick.call(viewport, event, true);
    expect(onSelect).toHaveBeenCalledWith("box:visible-edge", false);
    onSelect.mockClear();
    viewport.setSection(createSectionPlane([0, 0, 1], 0));
    wallDistance = edge.distance;
    pick.call(viewport, event, true);
    expect(onSelect).toHaveBeenCalledWith("box:visible-edge", false);
  } finally {
    viewport.dispose();
  }
});

it("clips CAD surfaces, edges, preview, selection and shared-target overlays, then restores them", () => {
  const { viewport } = makeViewport();
  try {
    viewport.setSelected(["box:visible-edge"]);
    viewport.setSharedTargets(["box:visible-edge"]);
    viewport.showPreviewMesh(nativeMesh());
    const state = viewport as unknown as {
      bodies: Map<string, { mesh: THREE.Mesh; edgeLines: THREE.LineSegments }>;
      previewMesh: THREE.Mesh;
      edgeSelectedLines: THREE.LineSegments;
      sharedEdgeLines: THREE.LineSegments;
    };
    const entry = state.bodies.get("box")!;
    const bodyMaterials = entry.mesh.material as THREE.Material[];
    const originalSides = bodyMaterials.map((material) => material.side);
    viewport.setSection(createSectionPlane([0, 0, 1], 0));
    const materials = [
      ...bodyMaterials,
      entry.edgeLines.material as THREE.Material,
      state.previewMesh.material as THREE.Material,
      state.edgeSelectedLines.material as THREE.Material,
      state.sharedEdgeLines.material as THREE.Material,
    ];
    expect(materials.every((material) => material.clippingPlanes?.length === 1)).toBe(true);
    expect(bodyMaterials.every((material) => material.side === THREE.DoubleSide)).toBe(true);
    expect(materials[0]!.clippingPlanes![0]!.normal.toArray()).toEqual([0, 0, 1]);
    viewport.setSection(null);
    expect(materials.every((material) => material.clippingPlanes === null)).toBe(true);
    expect(bodyMaterials.map((material) => material.side)).toEqual(originalSides);
    expect(viewport.renderStats().section).toMatchObject({ enabled: false, cappedBodies: 0, contourSegments: 0 });
  } finally {
    viewport.dispose();
  }
});

it("disposes generated cap and contour resources on disable and native remesh", () => {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const viewport = new CadViewport(document.createElement("div"), { onHover: vi.fn(), onSelect: vi.fn() });
  const plane = createSectionPlane([0, 0, 1], 0)!;
  try {
    viewport.syncMeshes({ cube: closedCubeMesh() });
    const nativeBefore = viewport.meshIdentity("cube");
    viewport.setSection(plane);
    const state = viewport as unknown as {
      bodies: Map<string, { sectionCap: THREE.Mesh | null; sectionContour: THREE.LineSegments | null }>;
    };
    const first = state.bodies.get("cube")!;
    expect(first.sectionCap).not.toBeNull();
    expect(first.sectionContour).not.toBeNull();
    expect(viewport.renderStats().section).toMatchObject({ enabled: true, cappedBodies: 1 });
    expect(viewport.renderStats().section.contourSegments).toBeGreaterThan(0);
    const capDisposed = vi.fn(), contourDisposed = vi.fn();
    first.sectionCap!.geometry.addEventListener("dispose", capDisposed);
    first.sectionContour!.geometry.addEventListener("dispose", contourDisposed);

    viewport.setSection(null);
    expect(capDisposed).toHaveBeenCalledTimes(1);
    expect(contourDisposed).toHaveBeenCalledTimes(1);
    expect(viewport.meshIdentity("cube")).toEqual(nativeBefore);

    viewport.setSection(plane);
    const remeshed = state.bodies.get("cube")!;
    const remeshCapDisposed = vi.fn(), remeshContourDisposed = vi.fn();
    remeshed.sectionCap!.geometry.addEventListener("dispose", remeshCapDisposed);
    remeshed.sectionContour!.geometry.addEventListener("dispose", remeshContourDisposed);
    viewport.syncMeshes({ cube: closedCubeMesh(2) });
    expect(remeshCapDisposed).toHaveBeenCalledTimes(1);
    expect(remeshContourDisposed).toHaveBeenCalledTimes(1);
    expect(viewport.meshIdentity("cube")?.revision).toBe(2);
  } finally {
    viewport.dispose();
  }
});

it("treats render-only caps as opaque, nonselectable boundaries for face and edge picks", () => {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const onSelect = vi.fn();
  const viewport = new CadViewport(document.createElement("div"), { onHover: vi.fn(), onSelect });
  try {
    viewport.syncMeshes({ cube: closedCubeMesh() });
    viewport.setSection(createSectionPlane([0, 0, 1], 0));
    const entry = (viewport as unknown as {
      bodies: Map<string, { mesh: THREE.Mesh; edgeLines: THREE.LineSegments; sectionCap: THREE.Mesh }>;
    }).bodies.get("cube")!;
    const raycaster = (viewport as unknown as { raycaster: THREE.Raycaster }).raycaster;
    const intersect = vi.spyOn(raycaster, "intersectObjects");
    intersect.mockReturnValue([
      intersection(entry.sectionCap, 0.5, -1),
      intersection(entry.mesh, 1, 0),
    ]);
    const pick = (viewport as unknown as { pick: (event: MouseEvent, commit: boolean) => void }).pick;
    pick.call(viewport, { clientX: 0, clientY: 0, ctrlKey: false, metaKey: false } as MouseEvent, true);
    expect(onSelect).not.toHaveBeenCalled();

    viewport.setPickMode("edge");
    intersect.mockImplementation((objects) => {
      if (objects[0] === entry.edgeLines) return [intersection(entry.edgeLines, 1, -1, 0)];
      if (objects[0] === entry.sectionCap) return [intersection(entry.sectionCap, 0.5, -1)];
      return [];
    });
    pick.call(viewport, { clientX: 0, clientY: 0, ctrlKey: false, metaKey: false } as MouseEvent, true);
    expect(onSelect).not.toHaveBeenCalled();
  } finally {
    viewport.dispose();
  }
});
