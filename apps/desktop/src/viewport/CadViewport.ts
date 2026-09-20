// CadViewport (§15-§16, §44-§45): imperative render loop, no React state at
// pointer frequency. Uses three-mesh-bvh for picking, stable backend IDs in
// userData (never scene indices). Demand rendering + BVH rebuild per body.

import * as THREE from "three";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import type { CoreMeshData } from "@kreoda/protocol";
import { CameraController } from "./CameraController";
import type { ReferencePlane } from "../reference/store";

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
  // Reference image planes (§29 Stage A): view aids, never CAD state.
  private refPlanes = new Map<string, THREE.Mesh>();
  // M6: texture-load generation per plane — a stale load finishing after a
  // newer one is dropped instead of overwriting it. Cleared with the plane.
  private refTexSeq = new Map<string, number>();
  private refMeasure: {
    id: string;
    points: [number, number][];
    resolve: (pts: [number, number][] | null) => void;
  } | null = null;
  private refMeasureTimer: ReturnType<typeof setTimeout> | null = null;

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
    // kreoda-core tessellation via syncMeshes() (§9, §67) — the viewport never
    // builds CAD geometry itself (grid/lights are display helpers only).

    this.renderer.domElement.addEventListener("pointermove", (e) =>
      this.pick(e, false),
    );
    this.renderer.domElement.addEventListener("click", (e) => {
      // Calibration capture runs before normal picking (§29 Stage A).
      if (this.refMeasure && this.captureMeasureClick(e)) return;
      this.pick(e, true);
    });
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

  /**
   * Reference image planes (§29 Stage A): reconcile textured quads sized in
   * mm on their principal plane. Display helpers only — never CAD state.
   */
  syncReferencePlanes(planes: ReferencePlane[]): void {
    const seen = new Set<string>();
    // C9 second layer: store already caps, but a crafted plane must never
    // OOM the GPU (16k² PNG → ~1 GiB RGBA) or scale beyond camera.far.
    const safe = planes
      .filter(
        (p) =>
          Number.isFinite(p.widthMm) &&
          Number.isFinite(p.heightMm) &&
          p.widthMm > 0 &&
          p.heightMm > 0 &&
          p.widthMm <= 1000000 &&
          p.heightMm <= 1000000 &&
          Number.isFinite(p.imageW) &&
          Number.isFinite(p.imageH) &&
          p.imageW > 0 &&
          p.imageH > 0 &&
          p.imageW <= 8192 &&
          p.imageH <= 8192 &&
          p.imageW * p.imageH <= 16000000,
      )
      .slice(0, 8);
    for (const p of safe) {
      seen.add(p.id);
      let mesh = this.refPlanes.get(p.id);
      if (!mesh) {
        const geo = new THREE.PlaneGeometry(1, 1);
        const mat = new THREE.MeshBasicMaterial({
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = -1;
        mesh.userData.refId = p.id;
        // C9: downscale before GPU upload (16k² PNG → ~1 GiB RGBA otherwise).
        // Full-res dataUrl stays in the store; only the texture is capped
        // (max 2048px per side). M6: the load carries a generation — a stale
        // load finishing after a newer one is dropped instead of overwriting
        // it. M7: failures drop the quad.
        const generation = (this.refTexSeq.get(p.id) ?? 0) + 1;
        this.refTexSeq.set(p.id, generation);
        void this.loadReferenceTexture(p.dataUrl, p.id).then(
          (tex) => {
            if (this.refTexSeq.get(p.id) !== generation) {
              tex.dispose();
              return;
            }
            const m = this.refPlanes.get(p.id);
            if (!m) {
              tex.dispose();
              return;
            }
            const old = (m.material as THREE.MeshBasicMaterial).map;
            (m.material as THREE.MeshBasicMaterial).map = tex;
            (m.material as THREE.MeshBasicMaterial).needsUpdate = true;
            if (old) old.dispose();
            this.requestRender();
          },
          () => {
            // Drop the untextured quad so failure is visible (dialog error
            // surfaces via the store path; here we never leave white quads).
            const m = this.refPlanes.get(p.id);
            if (m) {
              this.scene.remove(m);
              m.geometry.dispose();
              (m.material as THREE.MeshBasicMaterial).dispose();
              this.refPlanes.delete(p.id);
              this.requestRender();
            }
            console.error(`[reference] texture failed for ${p.id}`);
          },
        );
        this.scene.add(mesh);
        this.refPlanes.set(p.id, mesh);
      }
      mesh.scale.set(p.widthMm, p.heightMm, 1);
      mesh.userData.imageSize = [p.imageW, p.imageH] as [number, number];
      mesh.position.set(0, 0, 0);
      mesh.rotation.set(0, 0, 0);
      if (p.plane === "XY") {
        mesh.position.set(p.widthMm / 2, p.heightMm / 2, -1);
      } else if (p.plane === "XZ") {
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(p.widthMm / 2, -1, p.heightMm / 2);
      } else {
        mesh.rotation.y = Math.PI / 2;
        mesh.position.set(-1, p.widthMm / 2, p.heightMm / 2);
      }
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = p.opacity;
    }
    for (const [id, mesh] of [...this.refPlanes]) {
      if (seen.has(id)) continue;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      const mat = mesh.material as THREE.MeshBasicMaterial;
      if (mat.map) mat.map.dispose();
      mat.dispose();
      this.refPlanes.delete(id);
      // M6: invalidate in-flight loads so a late texture never resurrects
      // a deleted plane (the generation check drops it on arrival).
      this.refTexSeq.delete(id);
    }
    this.requestRender();
  }

  /**
   * C9: decode + downscale before GPU upload. The store keeps the full-res
   * dataUrl (calibration uses full-res pixels); the texture is capped at
   * 2048px per side so a 16k² image never hits the GPU at 1 GiB.
   * M6: every decoded bitmap is drawn into a canvas and closed by the caller
   * immediately afterwards — the GL texture never retains the CPU
   * ImageBitmap (up to 16 MiB per load), uniformly on both paths. toTexture
   * itself never closes (ownership stays with the caller). Rejects on
   * corrupt data (M7: caller drops the quad).
   */
  private loadReferenceTexture(
    dataUrl: string,
    id: string,
  ): Promise<THREE.Texture> {
    const MAX_TEX = 2048;
    const toTexture = (
      source: CanvasImageSource,
      w: number,
      h: number,
    ): THREE.Texture => {
      const scale = Math.min(1, MAX_TEX / Math.max(w, h));
      if (scale >= 1 && source instanceof HTMLImageElement) {
        const tex = new THREE.CanvasTexture(source);
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
      }
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };
    return (async (): Promise<THREE.Texture> => {
      // Fast path: createImageBitmap decodes off the main thread.
      // NOTE: data: URLs are decoded manually (no fetch) so CSP
      // connect-src 'self' never blocks the texture path (img-src already
      // allows data:/blob:).
      const dataUrlToBlob = (url: string): Blob | null => {
        // m16: fast path handles base64 only — percent-encoded data URLs
        // would decode to UTF-16 text instead of bytes, so they fall
        // through to the Image path below (which loads them correctly).
        const m = url.match(/^data:([^;,]+)?;base64,(.*)$/s);
        if (!m) return null;
        const mime = m[1] || "image/png";
        try {
          const bin = atob(m[2] ?? "");
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return new Blob([bytes.buffer as ArrayBuffer], { type: mime });
        } catch {
          return null;
        }
      };
      try {
        if (typeof createImageBitmap !== "undefined") {
          const blob = dataUrlToBlob(dataUrl);
          if (blob) {
            const bmp = await createImageBitmap(blob);
            try {
              return toTexture(bmp, bmp.width, bmp.height);
            } finally {
              bmp.close();
            }
          }
        }
      } catch {
        // Fall through to the Image path below (still honest errors).
      }
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error(`cannot decode image for ${id}`));
        im.src = dataUrl;
      });
      if (img.naturalWidth <= 0 || img.naturalHeight <= 0) {
        throw new Error("image has no pixels");
      }
      return toTexture(img, img.naturalWidth, img.naturalHeight);
    })();
  }

  /**
   * Capture the next two clicks on one reference plane as IMAGE PIXELS
   * (UV-mapped, no scale math involved). Resolves null on cancel.
   * C10: auto-cancels after 60 s so a forgotten measure never hijacks
   * the viewport forever.
   */
  beginReferenceMeasure(id: string): Promise<[number, number][] | null> {
    const mesh = this.refPlanes.get(id);
    if (!mesh) return Promise.resolve(null);
    if (this.refMeasure) this.refMeasure.resolve(null);
    if (this.refMeasureTimer) {
      clearTimeout(this.refMeasureTimer);
      this.refMeasureTimer = null;
    }
    return new Promise((resolve) => {
      this.refMeasure = { id, points: [], resolve };
      this.refMeasureTimer = setTimeout(() => {
    if (this.refMeasure) {
      this.refMeasure.resolve(null);
      this.refMeasure = null;
    }
    this.refTexSeq.clear();
        this.refMeasureTimer = null;
      }, 60000);
    });
  }

  cancelReferenceMeasure(): void {
    if (this.refMeasureTimer) {
      clearTimeout(this.refMeasureTimer);
      this.refMeasureTimer = null;
    }
    if (this.refMeasure) {
      this.refMeasure.resolve(null);
      this.refMeasure = null;
    }
  }

  /** Calibration click capture; true when the click was consumed. */
  private captureMeasureClick(e: MouseEvent): boolean {
    const m = this.refMeasure;
    if (!m) return false;
    const mesh = this.refPlanes.get(m.id);
    if (!mesh) {
      m.resolve(null);
      this.refMeasure = null;
      if (this.refMeasureTimer) {
        clearTimeout(this.refMeasureTimer);
        this.refMeasureTimer = null;
      }
      return true;
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObject(mesh, false);
    const uv = hits[0]?.uv;
    // C10: a miss must NOT swallow the click — orbit/pick stay alive while
    // measuring (the dialog shows "click on the image or Cancel").
    if (!uv) return false;
    const img = this.refImageSize(m.id);
    m.points.push([uv.x * img[0], (1 - uv.y) * img[1]]);
    if (m.points.length >= 2) {
      const pts = m.points;
      m.resolve(pts as [number, number][]);
      this.refMeasure = null;
      if (this.refMeasureTimer) {
        clearTimeout(this.refMeasureTimer);
        this.refMeasureTimer = null;
      }
    }
    return true;
  }

  private refImageSize(id: string): [number, number] {
    // Stored alongside the mesh userData at sync time (below).
    const mesh = this.refPlanes.get(id);
    const size = mesh?.userData.imageSize as [number, number] | undefined;
    return size ?? [1, 1];
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
    if (this.refMeasureTimer) {
      clearTimeout(this.refMeasureTimer);
      this.refMeasureTimer = null;
    }
    if (this.refMeasure) {
      this.refMeasure.resolve(null);
      this.refMeasure = null;
    }
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
