// CadViewport (§15-§16, §44-§45): imperative render loop, no React state at
// pointer frequency. Uses three-mesh-bvh for picking, stable backend IDs in
// userData (never scene indices). Demand rendering + BVH rebuild per body.

import * as THREE from "three";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import type { CoreMeshData } from "@intentcad/protocol";
import { CameraController } from "./CameraController";

(THREE.Mesh.prototype as unknown as { raycast: unknown }).raycast =
  acceleratedRaycast;

export type PickMode = "auto" | "body" | "face" | "edge";

export type ViewportEvents = {
  onHover: (persistentId: string | null) => void;
  onSelect: (persistentId: string, additive: boolean) => void;
};

interface BodyEntry {
  mesh: THREE.Mesh;
  faces: { persistentFaceId: string; triangleStart: number; triangleCount: number }[];
  edgeLines: THREE.LineSegments | null;
  segToEdge: string[];
}

export class CadViewport {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: CameraController;
  private raycaster = new THREE.Raycaster();
  private needsRender = true;
  private raf = 0;
  private disposed = false;
  private bodies = new Map<string, BodyEntry>();
  private hoveredId: string | null = null;
  private selectedIds = new Set<string>();
  private pickMode: PickMode = "auto";
  private onResize = (): void => this.resize();
  private edgeSelectedLines: THREE.LineSegments | null = null;
  private previewMesh: THREE.Mesh | null = null;

  constructor(
    private container: HTMLElement,
    private events: ViewportEvents,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.tabIndex = 0;

    this.scene.background = new THREE.Color(0x0b0e13);
    this.camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.5,
      20000,
    );
    this.controls = new CameraController(this.camera, this.renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x1a2230, 0.9);
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(220, -160, 320);
    this.scene.add(hemi, key);

    const grid = new THREE.GridHelper(1000, 50, 0x2a3a55, 0x1a2230);
    grid.rotation.x = Math.PI / 2;
    this.scene.add(grid);

    // Phase 1: scene starts EMPTY. Every body mesh arrives exclusively from
    // cad-core tessellation via syncMeshes() (§9, §67) — the viewport never
    // builds CAD geometry itself (grid/lights are display helpers only).

    this.renderer.domElement.addEventListener("pointermove", (e) =>
      this.pick(e, false),
    );
    this.renderer.domElement.addEventListener("click", (e) =>
      this.pick(e, true),
    );
    window.addEventListener("resize", this.onResize);
    this.loop();
  }

  /**
   * Reconcile scene bodies with the canonical mesh map (§66 delta spirit):
   * upsert every entry, drop missing ids, rebuild BVH only per changed body.
   */
  syncMeshes(meshes: Record<string, CoreMeshData>): void {
    for (const [id, data] of Object.entries(meshes)) {
      this.upsertBodyMesh(id, data);
    }
    for (const id of [...this.bodies.keys()]) {
      if (!(id in meshes)) this.removeBodyMesh(id);
    }
    this.applyHighlights();
  }

  setPickMode(mode: PickMode): void {
    this.pickMode = mode;
  }

  setCameraInputEnabled(on: boolean): void {
    this.controls.inputEnabled = on;
  }

  /** Named view preset from the view cube (§23). */
  setView(name: "top" | "front" | "right" | "iso" | "bottom" | "back" | "left"): void {
    this.controls.setView(name);
    this.requestRender();
  }

  /** Normalized camera view direction (target − position). */
  viewDir(): [number, number, number] {
    const d = this.controls.viewDir();
    return [d.x, d.y, d.z];
  }
  /**
   * World mm → viewport-element-relative px (for DOM overlays sharing the
   * container origin). Null when at/behind the camera plane. NOTE: this is
   * NOT client/window coords (see worldToClient for pointer math).
   */
  projectPoint(p: [number, number, number]): { x: number; y: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    // Camera-space depth FIRST: after the perspective divide, behind-camera
    // points can land inside [-1,1] mirrored, and on-plane points yield NaN.
    const camPos = this.camera.position;
    const viewDir = new THREE.Vector3();
    this.camera.getWorldDirection(viewDir);
    const toP = new THREE.Vector3(p[0] - camPos.x, p[1] - camPos.y, p[2] - camPos.z);
    if (toP.dot(viewDir) <= this.camera.near) return null;
    const v = new THREE.Vector3(p[0], p[1], p[2]).project(this.camera);
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
    return {
      x: ((v.x + 1) / 2) * rect.width,
      y: ((1 - v.y) / 2) * rect.height,
    };
  }

  /** Face pick returning world-space normal + grab point (Pull tool, §17). */
  pickFaceAt(
    clientX: number,
    clientY: number,
  ): {
    featureId: string;
    faceId: string;
    normal: THREE.Vector3;
    point: THREE.Vector3;
  } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(
      [...this.bodies.values()].map((en) => en.mesh),
      false,
    );
    if (!hits.length) return null;
    const hit = hits[0]!;
    const featureId = hit.object.userData.persistentId as string;
    const entry = this.bodies.get(featureId);
    const tri = hit.faceIndex ?? -1;
    const face = entry?.faces.find(
      (f) => tri >= f.triangleStart && tri < f.triangleStart + f.triangleCount,
    );
    if (!face || !hit.face) return null;
    return {
      featureId,
      faceId: face.persistentFaceId,
      normal: hit.face.normal.clone(),
      point: hit.point.clone(),
    };
  }

  /** World → client pixels (for drag math and E2E anchors). */
  worldToClient(p: THREE.Vector3): { x: number; y: number } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = p.clone().project(this.camera);
    return {
      x: rect.left + ((v.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - v.y) / 2) * rect.height,
    };
  }

  /** Approximate mm per screen pixel at the pan target (§17 drag scale). */
  mmPerPixel(): number {
    const dist = this.controls.distanceToTarget();
    const h = Math.max(1, this.container.clientHeight);
    return ((2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / h);
  }

  /**
   * Screen anchor + outward screen direction of a persistent face (E2E +
   * accessibility of direct manipulation without pointer precision).
   */
  faceScreenPoint(
    featureId: string,
    role: string,
  ): { x: number; y: number; nx: number; ny: number } | null {
    const entry = this.bodies.get(featureId);
    if (!entry) return null;
    const full = `${featureId}:${role}`;
    const range = entry.faces.find(
      (f) => f.persistentFaceId === full || f.persistentFaceId === role,
    );
    if (!range || range.triangleCount === 0) return null;
    const pos = entry.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const idx = entry.mesh.geometry.getIndex();
    const centroid = new THREE.Vector3();
    const n = new THREE.Vector3();
    const count = Math.min(range.triangleCount, 8);
    for (let t = 0; t < count; t++) {
      const tri = range.triangleStart + t;
      const a = idx ? idx.getX(tri * 3) : tri * 3;
      const b = idx ? idx.getX(tri * 3 + 1) : tri * 3 + 1;
      const c = idx ? idx.getX(tri * 3 + 2) : tri * 3 + 2;
      const pa = new THREE.Vector3().fromBufferAttribute(pos, a);
      const pb = new THREE.Vector3().fromBufferAttribute(pos, b);
      const pc = new THREE.Vector3().fromBufferAttribute(pos, c);
      centroid.add(pa).add(pb).add(pc);
      if (t === 0) {
        n.crossVectors(
          pb.clone().sub(pa),
          pc.clone().sub(pa),
        ).normalize();
      }
    }
    centroid.multiplyScalar(1 / (count * 3));
    const tip = centroid.clone().add(n);
    const s0 = this.worldToClient(centroid);
    const s1 = this.worldToClient(tip);
    const dx = s1.x - s0.x;
    const dy = s1.y - s0.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: s0.x, y: s0.y, nx: dx / len, ny: dy / len };
  }

  /** Transient preview mesh (§13): ghost overlay, never pickable/committed. */
  showPreviewMesh(data: CoreMeshData | null): void {
    if (this.previewMesh) {
      this.scene.remove(this.previewMesh);
      this.previewMesh.geometry.dispose();
      (this.previewMesh.material as THREE.Material).dispose();
      this.previewMesh = null;
    }
    if (!data) {
      this.requestRender();
      return;
    }
    const g = this.geometryFromCore(data);
    const ghost = new THREE.Mesh(
      g,
      new THREE.MeshStandardMaterial({
        color: 0xffb020,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
    );
    ghost.raycast = () => {};
    ghost.renderOrder = 3;
    this.scene.add(ghost);
    this.previewMesh = ghost;
    this.requestRender();
  }

  private makeBodyMaterials(): [
    THREE.MeshStandardMaterial,
    THREE.MeshStandardMaterial,
    THREE.MeshStandardMaterial,
  ] {
    const defs = [
      { color: 0x4f8cff, emissive: 0x000000 },
      { color: 0x6ea8ff, emissive: 0x1d3a6e },
      { color: 0x8a6a30, emissive: 0x6e4a1d },
    ] as const;
    return defs.map(
      (d) =>
        new THREE.MeshStandardMaterial({
          color: d.color,
          emissive: d.emissive,
          metalness: 0.15,
          roughness: 0.55,
        }),
    ) as [
      THREE.MeshStandardMaterial,
      THREE.MeshStandardMaterial,
      THREE.MeshStandardMaterial,
    ];
  }

  upsertBodyMesh(persistentId: string, data: CoreMeshData): void {
    const geometry = this.geometryFromCore(data);
    // One group per persistent face → per-face highlight via material index.
    geometry.clearGroups();
    for (const f of data.faces) {
      geometry.addGroup(f.triangleStart * 3, f.triangleCount * 3, 0);
    }
    geometry.boundsTree = new MeshBVH(geometry);
    const existing = this.bodies.get(persistentId);
    if (existing) {
      existing.mesh.geometry.dispose();
      existing.mesh.geometry = geometry;
      existing.faces = data.faces;
      this.refreshEdgeOverlay(persistentId, existing, data);
    } else {
      const materials = this.makeBodyMaterials();
      const mesh = new THREE.Mesh(geometry, materials);
      mesh.userData.persistentId = persistentId;
      const entry: BodyEntry = {
        mesh,
        faces: data.faces,
        edgeLines: null,
        segToEdge: [],
      };
      this.refreshEdgeOverlay(persistentId, entry, data);
      this.scene.add(mesh);
      this.bodies.set(persistentId, entry);
    }
    this.requestRender();
  }

  /** CAD edge overlay from core polylines — display only (§67). */
  private refreshEdgeOverlay(
    persistentId: string,
    entry: BodyEntry,
    data: CoreMeshData,
  ): void {
    if (entry.edgeLines) {
      this.scene.remove(entry.edgeLines);
      entry.edgeLines.geometry.dispose();
      (entry.edgeLines.material as THREE.Material).dispose();
      entry.edgeLines = null;
    }
    entry.segToEdge = [];
    if (data.edges.length === 0 || data.edgeVertices.length === 0) return;
    const pts: number[] = [];
    for (const e of data.edges) {
      const end = e.vertexStart + e.vertexCount;
      for (let v = e.vertexStart; v + 1 < end; v++) {
        pts.push(
          data.edgeVertices[v * 3]!,
          data.edgeVertices[v * 3 + 1]!,
          data.edgeVertices[v * 3 + 2]!,
          data.edgeVertices[v * 3 + 3]!,
          data.edgeVertices[v * 3 + 4]!,
          data.edgeVertices[v * 3 + 5]!,
        );
        entry.segToEdge.push(e.persistentEdgeId);
      }
    }
    if (pts.length === 0) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pts), 3));
    const lines = new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ color: 0x8fa8d0, transparent: true, opacity: 0.85 }),
    );
    lines.userData.persistentId = persistentId;
    lines.renderOrder = 1;
    this.scene.add(lines);
    entry.edgeLines = lines;
  }

  setHover(persistentId: string | null): void {
    this.hoveredId = persistentId;
    this.applyHighlights();
  }

  setSelected(ids: string[]): void {
    this.selectedIds = new Set(ids);
    this.applyHighlights();
  }

  private applyHighlights(): void {
    for (const [bodyId, entry] of this.bodies) {
      const bodySel = this.selectedIds.has(bodyId);
      const bodyHov = this.hoveredId === bodyId;
      const groups = entry.mesh.geometry.groups;
      for (let i = 0; i < groups.length; i++) {
        const fid = entry.faces[i]?.persistentFaceId;
        let idx = 0;
        if (fid && (bodySel || this.selectedIds.has(fid))) idx = 2;
        else if (fid && (bodyHov || this.hoveredId === fid)) idx = 1;
        groups[i]!.materialIndex = idx;
      }
    }
    this.rebuildSelectedEdgeOverlay();
    this.requestRender();
  }

  private rebuildSelectedEdgeOverlay(): void {
    if (this.edgeSelectedLines) {
      this.scene.remove(this.edgeSelectedLines);
      this.edgeSelectedLines.geometry.dispose();
      (this.edgeSelectedLines.material as THREE.Material).dispose();
      this.edgeSelectedLines = null;
    }
    const pts: number[] = [];
    for (const entry of this.bodies.values()) {
      if (!entry.edgeLines) continue;
      const pos = entry.edgeLines.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let s = 0; s < entry.segToEdge.length; s++) {
        if (!this.selectedIds.has(entry.segToEdge[s]!) && entry.segToEdge[s] !== this.hoveredId) {
          continue;
        }
        pts.push(
          pos.getX(s * 2), pos.getY(s * 2), pos.getZ(s * 2),
          pos.getX(s * 2 + 1), pos.getY(s * 2 + 1), pos.getZ(s * 2 + 1),
        );
      }
    }
    if (pts.length === 0) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pts), 3));
    this.edgeSelectedLines = new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ color: 0xffb020 }),
    );
    this.edgeSelectedLines.renderOrder = 2;
    this.scene.add(this.edgeSelectedLines);
  }

  requestRender(): void {
    this.needsRender = true;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    for (const id of [...this.bodies.keys()]) this.removeBodyMesh(id);
    this.showPreviewMesh(null);
    if (this.edgeSelectedLines) {
      this.scene.remove(this.edgeSelectedLines);
      this.edgeSelectedLines.geometry.dispose();
      (this.edgeSelectedLines.material as THREE.Material).dispose();
      this.edgeSelectedLines = null;
    }
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  private removeBodyMesh(persistentId: string): void {
    const entry = this.bodies.get(persistentId);
    if (!entry) return;
    this.scene.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    for (const m of entry.mesh.material as THREE.MeshStandardMaterial[]) {
      m.dispose();
    }
    if (entry.edgeLines) {
      this.scene.remove(entry.edgeLines);
      entry.edgeLines.geometry.dispose();
      (entry.edgeLines.material as THREE.Material).dispose();
    }
    this.bodies.delete(persistentId);
    this.requestRender();
  }

  /** Render-neutral buffer → three geometry (§67). No OCCT knowledge here. */
  private geometryFromCore(data: CoreMeshData): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
    g.setIndex(new THREE.BufferAttribute(data.indices, 1));
    g.computeBoundingSphere();
    return g;
  }

  private pick(e: MouseEvent, commit: boolean): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    let id: string | null = null;
    if (this.pickMode === "edge") {
      // Edge overlay picking (§16): Line raycast with a mm threshold.
      this.raycaster.params.Line.threshold = 1.5;
      const owners = new Map<THREE.Object3D, BodyEntry>();
      const lines: THREE.Object3D[] = [];
      for (const entry of this.bodies.values()) {
        if (!entry.edgeLines) continue;
        owners.set(entry.edgeLines, entry);
        lines.push(entry.edgeLines);
      }
      const hits = this.raycaster.intersectObjects(lines, false);
      if (hits.length) {
        const hit = hits[0]!;
        const entry = owners.get(hit.object);
        // Non-indexed LineSegments: three reports the segment's start VERTEX
        // index (0, 2, 4…), so the segment number is index / 2.
        const seg = Math.floor((hit.index ?? 0) / 2);
        id = entry?.segToEdge[seg] ?? null;
      }
    } else {
      const meshes = [...this.bodies.values()].map((en) => en.mesh);
      const hits = this.raycaster.intersectObjects(meshes, false);
      if (hits.length) {
        const hit = hits[0]!;
        const bodyId = hit.object.userData.persistentId as string;
        const entry = this.bodies.get(bodyId);
        const tri = hit.faceIndex ?? -1;
        const face = entry?.faces.find(
          (f) => tri >= f.triangleStart && tri < f.triangleStart + f.triangleCount,
        );
        // auto (beginner contextual, §16) selects the persistent face;
        // body mode selects the whole solid; face mode selects a face or
        // nothing (real filter, not an auto alias).
        if (this.pickMode === "body") id = bodyId;
        else if (this.pickMode === "face") id = face ? face.persistentFaceId : null;
        else id = this.pickMode === "auto" && !face ? bodyId : (face ? face.persistentFaceId : null);
      }
    }
    if (commit && id) this.events.onSelect(id, e.ctrlKey || e.metaKey);
    else this.events.onHover(id);
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.requestRender();
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (!this.needsRender) return;
    this.needsRender = false;
    this.renderer.render(this.scene, this.camera);
  };
}
