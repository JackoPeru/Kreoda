// CadViewport (§15-§16, §44-§45): imperative render loop, no React state at
// pointer frequency. Uses three-mesh-bvh for picking, stable backend IDs in
// userData (never scene indices). Demand rendering + BVH rebuild per body.

import * as THREE from "three";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import type { CoreMeshData } from "@kreoda/protocol";
import { CameraController } from "./CameraController";
import type { ReferencePlane } from "../reference/store";
import { buildSectionCut } from "../section/mesh-cut";
import { isSectionPlane, isVisibleAtSection, SECTION_PICK_TOLERANCE_MM, type SectionPlane } from "../section/plane";

(THREE.Mesh.prototype as unknown as { raycast: unknown }).raycast =
  acceleratedRaycast;

export type PickMode = "auto" | "body" | "face" | "edge";

export type ViewportEvents = {
  onHover: (persistentId: string | null) => void;
  onSelect: (persistentId: string, additive: boolean) => void;
};

interface BodyEntry {
  coreMesh: CoreMeshData;
  mesh: THREE.Mesh;
  originalMaterialSides: THREE.Side[];
  faces: { persistentFaceId: string; triangleStart: number; triangleCount: number }[];
  edgeLines: THREE.LineSegments | null;
  segToEdge: string[];
  sectionCap: THREE.Mesh | null;
  sectionContour: THREE.LineSegments | null;
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
  private renderedFrames = 0;
  private renderCpuTotalMs = 0;
  private renderCpuMaxMs = 0;
  private bodies = new Map<string, BodyEntry>();
  private hoveredId: string | null = null;
  private selectedIds = new Set<string>();
  private sharedTargetIds = new Set<string>();
  private sharedEdgeLines: THREE.LineSegments | null = null;
  private pickMode: PickMode = "auto";
  private sectionPlane: SectionPlane | null = null;
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
  private onCanvasPointerMove = (event: PointerEvent): void => {
    if (!this.controls.isNavigating()) this.pick(event, false);
  };
  private onCanvasClick = (event: MouseEvent): void => {
    if (event.button !== 0 || this.controls.consumeClick()) return;
    // Calibration capture runs before normal picking (§29 Stage A).
    if (this.refMeasure && this.captureMeasureClick(event)) return;
    this.pick(event, true);
  };

  constructor(
    private container: HTMLElement,
    private events: ViewportEvents,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.localClippingEnabled = true;
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
    this.controls = new CameraController(this.camera, this.renderer.domElement, {
      onChange: () => this.requestRender(),
      onFrameAll: () => this.frameAll(),
      onFrameSelection: () => this.frameSelection(),
    });

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

    this.renderer.domElement.addEventListener("pointermove", this.onCanvasPointerMove);
    this.renderer.domElement.addEventListener("click", this.onCanvasClick);
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
    this.rebuildSharedEdgeOverlay();
  }

  setPickMode(mode: PickMode): void {
    this.pickMode = mode;
  }

  /** Reversible display-only cut; native buffers and topology stay untouched. */
  setSection(plane: SectionPlane | null): void {
    if (plane !== null && !isSectionPlane(plane)) return;
    this.sectionPlane = plane ? { ...plane, normal: [...plane.normal] } : null;
    this.renderer.localClippingEnabled = this.sectionPlane !== null;
    for (const entry of this.bodies.values()) {
      const materials = entry.mesh.material as THREE.MeshStandardMaterial[];
      materials.forEach((material, index) => {
        material.side = this.sectionPlane ? THREE.DoubleSide : entry.originalMaterialSides[index]!;
        this.applySectionClip(material);
      });
      if (entry.edgeLines) this.applySectionClip(entry.edgeLines.material as THREE.Material);
      this.updateSectionPresentation(entry);
    }
    if (this.previewMesh) this.applySectionClip(this.previewMesh.material as THREE.Material);
    if (this.edgeSelectedLines) this.applySectionClip(this.edgeSelectedLines.material as THREE.Material);
    if (this.sharedEdgeLines) this.applySectionClip(this.sharedEdgeLines.material as THREE.Material);
    this.requestRender();
  }

  private applySectionClip(material: THREE.Material): void {
    if (!this.sectionPlane) {
      material.clippingPlanes = null;
    } else {
      const sign = this.sectionPlane.inverted ? -1 : 1;
      material.clippingPlanes = [new THREE.Plane(
        new THREE.Vector3(...this.sectionPlane.normal).multiplyScalar(sign),
        -this.sectionPlane.offsetMm * sign,
      )];
    }
    material.needsUpdate = true;
  }

  private clearSectionPresentation(entry: BodyEntry): void {
    if (entry.sectionCap) {
      this.scene.remove(entry.sectionCap);
      entry.sectionCap.geometry.dispose();
      (entry.sectionCap.material as THREE.Material).dispose();
      entry.sectionCap = null;
    }
    if (entry.sectionContour) {
      this.scene.remove(entry.sectionContour);
      entry.sectionContour.geometry.dispose();
      (entry.sectionContour.material as THREE.Material).dispose();
      entry.sectionContour = null;
    }
  }

  private updateSectionPresentation(entry: BodyEntry): void {
    this.clearSectionPresentation(entry);
    if (!this.sectionPlane) return;
    const cut = buildSectionCut(entry.coreMesh.positions, entry.coreMesh.indices, this.sectionPlane, entry.coreMesh.normals);
    if (cut.capIndices.length >= 3) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(cut.capPositions, 3));
      geometry.setIndex(new THREE.BufferAttribute(cut.capIndices, 1));
      geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({
        color: 0x4d5869,
        metalness: 0.05,
        roughness: 0.82,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const cap = new THREE.Mesh(geometry, material);
      cap.userData.sectionCut = true;
      cap.renderOrder = 2;
      entry.sectionCap = cap;
      this.scene.add(cap);
    }
    if (cut.contourPositions.length >= 6) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(cut.contourPositions, 3));
      const contour = new THREE.LineSegments(
        geometry,
        new THREE.LineBasicMaterial({ color: 0xf2b35d, transparent: true, opacity: 1 }),
      );
      contour.raycast = () => {};
      contour.renderOrder = 4;
      entry.sectionContour = contour;
      this.scene.add(contour);
    }
  }

  /** Fit all actual mesh bounds; empty document keeps the useful origin view. */
  frameAll(): void {
    const bounds = new THREE.Box3().makeEmpty();
    for (const entry of this.bodies.values()) {
      const geometry = entry.mesh.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      if (geometry.boundingBox) bounds.union(geometry.boundingBox);
    }
    if (bounds.isEmpty()) {
      this.controls.frameAll();
      return;
    }
    const center = bounds.getCenter(new THREE.Vector3());
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const vertical = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const horizontal = Math.atan(Math.tan(vertical) * Math.max(1e-3, this.camera.aspect));
    const halfFov = Math.min(vertical, horizontal);
    const distance = Math.max(60, sphere.radius / Math.sin(halfFov) * 1.15);
    this.controls.frameAll(distance, center);
  }

  /** Fit selected body, persistent face triangles, and/or edge polylines. */
  frameSelection(): void {
    const bounds = new THREE.Box3().makeEmpty();
    for (const id of this.selectedIds) {
      const cut = id.indexOf(":");
      const featureId = cut < 0 ? id : id.slice(0, cut);
      const entry = this.bodies.get(featureId);
      if (!entry) continue;
      if (cut < 0) {
        const geometry = entry.mesh.geometry;
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        if (geometry.boundingBox) bounds.union(geometry.boundingBox);
        continue;
      }
      const face = entry.faces.find((item) =>
        item.persistentFaceId === id || item.persistentFaceId === id.slice(cut + 1),
      );
      if (face) {
        const position = entry.mesh.geometry.getAttribute("position");
        const index = entry.mesh.geometry.getIndex();
        if (!position) continue;
        for (let triangle = face.triangleStart; triangle < face.triangleStart + face.triangleCount; triangle++) {
          for (let vertex = 0; vertex < 3; vertex++) {
            const vertexIndex = index ? index.getX(triangle * 3 + vertex) : triangle * 3 + vertex;
            bounds.expandByPoint(new THREE.Vector3().fromBufferAttribute(position, vertexIndex));
          }
        }
        continue;
      }
      const positions = entry.edgeLines?.geometry.getAttribute("position");
      if (!positions) continue;
      for (let segment = 0; segment < entry.segToEdge.length; segment++) {
        if (entry.segToEdge[segment] !== id) continue;
        bounds.expandByPoint(new THREE.Vector3().fromBufferAttribute(positions, segment * 2));
        bounds.expandByPoint(new THREE.Vector3().fromBufferAttribute(positions, segment * 2 + 1));
      }
    }
    if (bounds.isEmpty()) {
      this.frameAll();
      return;
    }
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
    this.controls.frameSelection(center, radius);
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

  cancelCameraGesture(): void {
    this.controls.cancelGesture();
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
    const objects = [...this.bodies.values()].flatMap((entry) => [
      ...(entry.sectionCap ? [entry.sectionCap] : []),
      entry.mesh,
    ]);
    const hits = this.raycaster.intersectObjects(objects, false);
    let hit: THREE.Intersection<THREE.Object3D> | undefined;
    let capDistance = Number.POSITIVE_INFINITY;
    for (const candidate of hits) {
      if (candidate.object.userData.sectionCut) {
        capDistance = Math.min(capDistance, candidate.distance);
        continue;
      }
      if (candidate.distance > capDistance + SECTION_PICK_TOLERANCE_MM) return null;
      if (!this.isHitVisible(candidate)) continue;
      const owner = candidate.object.userData.persistentId as string;
      const entry = this.bodies.get(owner);
      const tri = candidate.faceIndex ?? -1;
      if (candidate.face && entry?.faces.some(
        (face) => tri >= face.triangleStart && tri < face.triangleStart + face.triangleCount,
      )) {
        hit = candidate;
        break;
      }
    }
    if (!hit?.face) return null;
    const featureId = hit.object.userData.persistentId as string;
    const entry = this.bodies.get(featureId);
    const tri = hit.faceIndex ?? -1;
    const face = entry?.faces.find(
      (f) => tri >= f.triangleStart && tri < f.triangleStart + f.triangleCount,
    );
    if (!entry || !face || !hit.face) return null;
    return {
      featureId,
      faceId: face.persistentFaceId,
      normal: this.nativeOutwardNormal(hit, entry),
      point: hit.point.clone(),
    };
  }

  private nativeOutwardNormal(
    hit: THREE.Intersection<THREE.Object3D>,
    entry: BodyEntry,
  ): THREE.Vector3 {
    const face = hit.face;
    if (!face) return new THREE.Vector3(0, 0, 1);
    const normals = entry.mesh.geometry.getAttribute("normal") as THREE.BufferAttribute | undefined;
    const bary = hit.barycoord;
    const normal = normals && bary
      ? new THREE.Vector3()
          .fromBufferAttribute(normals, face.a).multiplyScalar(bary.x)
          .add(new THREE.Vector3().fromBufferAttribute(normals, face.b).multiplyScalar(bary.y))
          .add(new THREE.Vector3().fromBufferAttribute(normals, face.c).multiplyScalar(bary.z))
      : face.normal.clone();
    if (normal.lengthSq() <= 1e-12) normal.copy(face.normal);
    return normal
      .applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
      .normalize();
  }

  private isHitVisible(hit: { point: THREE.Vector3 }): boolean {
    return !this.sectionPlane || isVisibleAtSection(
      [hit.point.x, hit.point.y, hit.point.z],
      this.sectionPlane,
    );
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
  ): { x: number; y: number; nx: number; ny: number; normal: [number, number, number]; point: [number, number, number] } | null {
    const entry = this.bodies.get(featureId);
    if (!entry) return null;
    const full = `${featureId}:${role}`;
    const range = entry.faces.find(
      (f) => f.persistentFaceId === full || f.persistentFaceId === role,
    );
    if (!range || range.triangleCount === 0) return null;
    const pos = entry.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const idx = entry.mesh.geometry.getIndex();
    const rect = this.renderer.domElement.getBoundingClientRect();
    for (let t = 0; t < range.triangleCount; t++) {
      const tri = range.triangleStart + t;
      const a = idx ? idx.getX(tri * 3) : tri * 3;
      const b = idx ? idx.getX(tri * 3 + 1) : tri * 3 + 1;
      const c = idx ? idx.getX(tri * 3 + 2) : tri * 3 + 2;
      const pa = new THREE.Vector3().fromBufferAttribute(pos, a);
      const pb = new THREE.Vector3().fromBufferAttribute(pos, b);
      const pc = new THREE.Vector3().fromBufferAttribute(pos, c);
      const polygon = [pa, pb, pc];
      if (this.sectionPlane) {
        const plane = this.sectionPlane;
        const side = (point: THREE.Vector3): number => {
          const value = point.x * plane.normal[0] + point.y * plane.normal[1] +
            point.z * plane.normal[2] - plane.offsetMm;
          return plane.inverted ? -value : value;
        };
        const clipped: THREE.Vector3[] = [];
        let previous = polygon[polygon.length - 1]!;
        let previousSide = side(previous);
        for (const current of polygon) {
          const currentSide = side(current);
          const previousInside = previousSide >= 0;
          const currentInside = currentSide >= 0;
          if (previousInside !== currentInside) {
            clipped.push(previous.clone().lerp(current, previousSide / (previousSide - currentSide)));
          }
          if (currentInside) clipped.push(current);
          previous = current;
          previousSide = currentSide;
        }
        polygon.splice(0, polygon.length, ...clipped);
      }
      if (polygon.length < 3) continue;

      // Each clipped polygon stays within this original native triangle. Its
      // fan-triangle centroids therefore remain on real mesh surface, unlike
      // an average over multiple tessellation triangles (which can fall in a
      // cylindrical hole). Validate each projected candidate against the
      // production pick path so the returned anchor is also unobstructed by
      // the section cap and resolves to this persistent native face.
      for (let vertex = 1; vertex < polygon.length - 1; vertex++) {
        const candidate = polygon[0]!.clone()
          .add(polygon[vertex]!)
          .add(polygon[vertex + 1]!)
          .multiplyScalar(1 / 3);
        const screen = this.worldToClient(candidate);
        if (screen.x < rect.left || screen.x >= rect.right || screen.y < rect.top || screen.y >= rect.bottom) continue;
        const hit = this.pickFaceAt(screen.x, screen.y);
        if (!hit || hit.featureId !== featureId || hit.faceId !== range.persistentFaceId) continue;

        const point = hit.point;
        const base = this.worldToClient(point);
        const tip = this.worldToClient(point.clone().add(hit.normal));
        const dx = tip.x - base.x;
        const dy = tip.y - base.y;
        const len = Math.hypot(dx, dy) || 1;
        return {
          x: base.x,
          y: base.y,
          nx: dx / len,
          ny: dy / len,
          normal: [hit.normal.x, hit.normal.y, hit.normal.z],
          point: [point.x, point.y, point.z],
        };
      }
    }
    return null;
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
    this.applySectionClip(ghost.material as THREE.Material);
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
    THREE.MeshStandardMaterial,
  ] {
    // UX-5 presentation: neutral grey solids, soft hover, blue selection
    // (matches --kreoda-accent). Preview ghosts stay amber — uncommitted
    // state is a semantic warning, not decoration.
    const defs = [
      { color: 0x939db0, emissive: 0x000000 },
      { color: 0xa8bedd, emissive: 0x111c2c },
      { color: 0x4f8cff, emissive: 0x1e3a6e },
      { color: 0x4bcab0, emissive: 0x11352e },
    ] as const;
    const materials = defs.map(
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
      THREE.MeshStandardMaterial,
    ];
    for (const material of materials) this.applySectionClip(material);
    return materials;
  }

  upsertBodyMesh(persistentId: string, data: CoreMeshData): void {
    const existing = this.bodies.get(persistentId);
    if (existing?.coreMesh === data) return;
    const geometry = this.geometryFromCore(data);
    // One group per persistent face → per-face highlight via material index.
    geometry.clearGroups();
    for (const f of data.faces) {
      geometry.addGroup(f.triangleStart * 3, f.triangleCount * 3, 0);
    }
    geometry.boundsTree = new MeshBVH(geometry);
    if (existing) {
      this.clearSectionPresentation(existing);
      existing.mesh.geometry.dispose();
      existing.mesh.geometry = geometry;
      existing.faces = data.faces;
      existing.coreMesh = data;
      this.refreshEdgeOverlay(persistentId, existing, data);
      this.updateSectionPresentation(existing);
    } else {
      const materials = this.makeBodyMaterials();
      const mesh = new THREE.Mesh(geometry, materials);
      const originalMaterialSides = materials.map((material) => material.side);
      if (this.sectionPlane) materials.forEach((material) => { material.side = THREE.DoubleSide; });
      mesh.userData.persistentId = persistentId;
      const entry: BodyEntry = {
        coreMesh: data,
        mesh,
        originalMaterialSides,
        faces: data.faces,
        edgeLines: null,
        segToEdge: [],
        sectionCap: null,
        sectionContour: null,
      };
      this.refreshEdgeOverlay(persistentId, entry, data);
      this.scene.add(mesh);
      this.bodies.set(persistentId, entry);
      this.updateSectionPresentation(entry);
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
    this.applySectionClip(lines.material as THREE.Material);
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

  setSharedTargets(ids: string[]): void {
    this.sharedTargetIds = new Set(ids);
    this.applyHighlights();
    this.rebuildSharedEdgeOverlay();
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
        else if (fid && (this.sharedTargetIds.has(bodyId) || this.sharedTargetIds.has(fid))) idx = 3;
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
      new THREE.LineBasicMaterial({ color: 0x7fb2ff }),
    );
    this.applySectionClip(this.edgeSelectedLines.material as THREE.Material);
    this.edgeSelectedLines.renderOrder = 2;
    this.scene.add(this.edgeSelectedLines);
  }

  private rebuildSharedEdgeOverlay(): void {
    if (this.sharedEdgeLines) {
      this.scene.remove(this.sharedEdgeLines);
      this.sharedEdgeLines.geometry.dispose();
      (this.sharedEdgeLines.material as THREE.Material).dispose();
      this.sharedEdgeLines = null;
    }
    const points: number[] = [];
    for (const entry of this.bodies.values()) {
      const positions = entry.edgeLines?.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (!positions) continue;
      for (let segment = 0; segment < entry.segToEdge.length; segment++) {
        if (!this.sharedTargetIds.has(entry.segToEdge[segment]!)) continue;
        for (const vertex of [segment * 2, segment * 2 + 1])
          points.push(positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex));
      }
    }
    if (points.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(points), 3));
    this.sharedEdgeLines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x4bcab0 }));
    this.applySectionClip(this.sharedEdgeLines.material as THREE.Material);
    this.sharedEdgeLines.renderOrder = 3;
    this.scene.add(this.sharedEdgeLines);
  }

  requestRender(): void {
    this.needsRender = true;
  }

  /** Renderer submissions and object counts; CPU time excludes GPU completion. */
  meshIdentity(featureId: string): { geometryId: string; revision: number } | null {
    const body = this.bodies.get(featureId);
    return body ? { geometryId: body.mesh.geometry.uuid, revision: body.coreMesh.revision } : null;
  }

  /** Native mesh and render-only cap geometry diagnostics for E2E evidence. */
  sectionGeometryDiagnostics(
    featureId: string,
    samplePointMm: [number, number, number],
    faceRole: string,
  ) {
    const entry = this.bodies.get(featureId);
    if (!entry) return null;
    const capGeometry = entry.sectionCap?.geometry;
    const capPositions = capGeometry?.getAttribute("position") as THREE.BufferAttribute | undefined;
    const capIndices = capGeometry?.getIndex();
    let capAreaMm2 = 0;
    let capCoversSample = false;
    const capTriangleCount = capIndices ? capIndices.count / 3 : 0;
    const sample = new THREE.Vector3(...samplePointMm);
    if (capPositions && capIndices) {
      for (let triangle = 0; triangle < capIndices.count; triangle += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(capPositions, capIndices.getX(triangle));
        const b = new THREE.Vector3().fromBufferAttribute(capPositions, capIndices.getX(triangle + 1));
        const c = new THREE.Vector3().fromBufferAttribute(capPositions, capIndices.getX(triangle + 2));
        const ab = b.clone().sub(a);
        const ac = c.clone().sub(a);
        const cross = ab.clone().cross(ac);
        capAreaMm2 += cross.length() / 2;
        const ap = sample.clone().sub(a);
        const normalLength = cross.length();
        if (normalLength <= 1e-12 || Math.abs(ap.dot(cross) / normalLength) > 1e-5) continue;
        const d00 = ab.dot(ab), d01 = ab.dot(ac), d11 = ac.dot(ac);
        const d20 = ap.dot(ab), d21 = ap.dot(ac);
        const denominator = d00 * d11 - d01 * d01;
        if (Math.abs(denominator) <= 1e-12) continue;
        const v = (d11 * d20 - d01 * d21) / denominator;
        const w = (d00 * d21 - d01 * d20) / denominator;
        const u = 1 - v - w;
        if (u >= -1e-8 && v >= -1e-8 && w >= -1e-8) capCoversSample = true;
      }
    }

    const fullFaceId = `${featureId}:${faceRole}`;
    const face = entry.faces.find((item) =>
      item.persistentFaceId === fullFaceId || item.persistentFaceId === faceRole,
    );
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    let windingOpposedTriangles = 0;
    let rayCandidates = 0;
    let frontSideWallHits = 0;
    let frontSideUnoccludedWallHits = 0;
    let doubleSideWallHits = 0;
    let capOccludesDoubleSideWallHits = 0;
    let productionWallHits = 0;
    const positions = entry.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const normals = entry.mesh.geometry.getAttribute("normal") as THREE.BufferAttribute | undefined;
    const indices = entry.mesh.geometry.getIndex();
    const isTargetFaceHit = (hit: THREE.Intersection<THREE.Object3D>): boolean => {
      const triangle = hit.faceIndex ?? -1;
      return entry.faces.some((item) =>
        (item.persistentFaceId === face?.persistentFaceId) &&
        triangle >= item.triangleStart && triangle < item.triangleStart + item.triangleCount,
      );
    };
    if (face) {
      for (let triangle = 0; triangle < face.triangleCount; triangle++) {
        const first = (face.triangleStart + triangle) * 3;
        const vertices = [0, 1, 2].map((corner) => indices ? indices.getX(first + corner) : first + corner);
        for (const vertex of vertices) {
          const z = positions.getZ(vertex);
          minZ = Math.min(minZ, z);
          maxZ = Math.max(maxZ, z);
        }
        if (normals) {
          const a = new THREE.Vector3().fromBufferAttribute(positions, vertices[0]!);
          const b = new THREE.Vector3().fromBufferAttribute(positions, vertices[1]!);
          const c = new THREE.Vector3().fromBufferAttribute(positions, vertices[2]!);
          const winding = b.sub(a).cross(c.sub(a));
          const supplied = new THREE.Vector3()
            .fromBufferAttribute(normals, vertices[0]!)
            .add(new THREE.Vector3().fromBufferAttribute(normals, vertices[1]!))
            .add(new THREE.Vector3().fromBufferAttribute(normals, vertices[2]!));
          if (winding.dot(supplied) < 0) windingOpposedTriangles++;
        }
      }

      if (this.sectionPlane) {
        const plane = this.sectionPlane;
        const rect = this.renderer.domElement.getBoundingClientRect();
        const materials = Array.isArray(entry.mesh.material) ? entry.mesh.material : [entry.mesh.material];
        const activeSides = materials.map((material) => material.side);
        for (let triangle = 0; triangle < face.triangleCount; triangle++) {
          const first = (face.triangleStart + triangle) * 3;
          const polygon = [0, 1, 2].map((corner) => {
            const vertex = indices ? indices.getX(first + corner) : first + corner;
            return new THREE.Vector3().fromBufferAttribute(positions, vertex);
          });
          const side = (point: THREE.Vector3): number => {
            const value = point.x * plane.normal[0] + point.y * plane.normal[1] +
              point.z * plane.normal[2] - plane.offsetMm;
            return plane.inverted ? -value : value;
          };
          const clipped: THREE.Vector3[] = [];
          let previous = polygon[polygon.length - 1]!;
          let previousSide = side(previous);
          for (const current of polygon) {
            const currentSide = side(current);
            if ((previousSide >= 0) !== (currentSide >= 0)) {
              clipped.push(previous.clone().lerp(current, previousSide / (previousSide - currentSide)));
            }
            if (currentSide >= 0) clipped.push(current);
            previous = current;
            previousSide = currentSide;
          }
          polygon.splice(0, polygon.length, ...clipped);
          for (let vertex = 1; vertex < polygon.length - 1; vertex++) {
            const candidate = polygon[0]!.clone()
              .add(polygon[vertex]!)
              .add(polygon[vertex + 1]!)
              .multiplyScalar(1 / 3);
            const screen = this.worldToClient(candidate);
            if (screen.x < rect.left || screen.x >= rect.right || screen.y < rect.top || screen.y >= rect.bottom) continue;
            const ndc = new THREE.Vector2(
              ((screen.x - rect.left) / rect.width) * 2 - 1,
              -((screen.y - rect.top) / rect.height) * 2 + 1,
            );
            this.raycaster.setFromCamera(ndc, this.camera);
            rayCandidates++;
            let frontHit: THREE.Intersection<THREE.Object3D> | undefined;
            try {
              materials.forEach((material) => { material.side = THREE.FrontSide; });
              frontHit = this.raycaster.intersectObject(entry.mesh, false).find(isTargetFaceHit);
            } finally {
              materials.forEach((material, index) => { material.side = activeSides[index]!; });
            }
            const capHit = entry.sectionCap
              ? this.raycaster.intersectObject(entry.sectionCap, false)[0]
              : undefined;
            if (frontHit) {
              frontSideWallHits++;
              if (!capHit || capHit.distance >= frontHit.distance) frontSideUnoccludedWallHits++;
            }
            const productionHit = this.pickFaceAt(screen.x, screen.y);
            if (productionHit?.featureId === featureId && productionHit.faceId === face.persistentFaceId) {
              productionWallHits++;
            }

            let doubleHit: THREE.Intersection<THREE.Object3D> | undefined;
            try {
              materials.forEach((material) => { material.side = THREE.DoubleSide; });
              doubleHit = this.raycaster.intersectObject(entry.mesh, false).find(isTargetFaceHit);
            } finally {
              materials.forEach((material, index) => { material.side = activeSides[index]!; });
            }
            if (doubleHit) {
              doubleSideWallHits++;
              const doubleCapHit = entry.sectionCap
                ? this.raycaster.intersectObject(entry.sectionCap, false)[0]
                : undefined;
              if (doubleCapHit && doubleCapHit.distance < doubleHit.distance) capOccludesDoubleSideWallHits++;
            }
          }
        }
      }
    }
    return {
      capTriangleCount,
      capAreaMm2,
      capCoversSample,
      rayCandidates,
      frontSideWallHits,
      frontSideUnoccludedWallHits,
      doubleSideWallHits,
      capOccludesDoubleSideWallHits,
      productionWallHits,
      nativeMaterialSides: (Array.isArray(entry.mesh.material) ? entry.mesh.material : [entry.mesh.material])
        .map((material) => material.side === THREE.DoubleSide ? "double" : material.side === THREE.BackSide ? "back" : "front"),
      nativeFace: face ? {
        persistentFaceId: face.persistentFaceId,
        triangleCount: face.triangleCount,
        zBoundsMm: [minZ, maxZ] as [number, number],
        windingOpposedTriangles,
      } : null,
    };
  }

  renderStats() {
    return {
      renderedFrames: this.renderedFrames,
      renderCpuTotalMs: this.renderCpuTotalMs,
      renderCpuMaxMs: this.renderCpuMaxMs,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      section: {
        enabled: this.sectionPlane !== null,
        plane: this.sectionPlane ? { ...this.sectionPlane, normal: [...this.sectionPlane.normal] as [number, number, number] } : null,
        cappedBodies: [...this.bodies.values()].filter((entry) => entry.sectionCap !== null).length,
        contourSegments: [...this.bodies.values()].reduce((total, entry) => {
          const position = entry.sectionContour?.geometry.getAttribute("position");
          return total + (position ? position.count / 2 : 0);
        }, 0),
      },
    };
  }

  sharedTargetSummary(): { ids: string[]; faceGroups: number; edgeSegments: number } {
    return { ids: [...this.sharedTargetIds].sort(),
      faceGroups: [...this.bodies.values()].reduce((total, entry) => total +
        entry.mesh.geometry.groups.filter(group => group.materialIndex === 3).length, 0),
      edgeSegments: (this.sharedEdgeLines?.geometry.getAttribute("position").count ?? 0) / 2 };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    this.renderer.domElement.removeEventListener("pointermove", this.onCanvasPointerMove);
    this.renderer.domElement.removeEventListener("click", this.onCanvasClick);
    this.controls.dispose();
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
    this.syncReferencePlanes([]);
    this.sharedTargetIds.clear();
    this.rebuildSharedEdgeOverlay();
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
    this.clearSectionPresentation(entry);
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
      const surfaces = [...this.bodies.values()].flatMap((entry) => [
        ...(entry.sectionCap ? [entry.sectionCap] : []), entry.mesh,
      ]);
      const surfaceSet = new Set(surfaces);
      const hit = hits.find((candidate) => {
        if (!this.isHitVisible(candidate)) return false;
        const entry = owners.get(candidate.object);
        // Non-indexed LineSegments: three reports the segment's start VERTEX
        // index (0, 2, 4…), so the segment number is index / 2.
        const seg = Math.floor((candidate.index ?? 0) / 2);
        if (!entry?.segToEdge[seg]) return false;
        if (!this.sectionPlane) return true;
        // Test visibility at the actual segment point, retaining line tolerance:
        // the mouse ray may fall on the adjacent face rather than on the edge.
        const savedRay = this.raycaster.ray.clone();
        const edgeDistance = savedRay.origin.distanceTo(candidate.point);
        try {
          this.raycaster.ray.direction.copy(candidate.point).sub(savedRay.origin).normalize();
          const obstruction = this.raycaster.intersectObjects(surfaces, false).find((surface) =>
            surfaceSet.has(surface.object as THREE.Mesh) &&
            (surface.object.userData.sectionCut || this.isHitVisible(surface)),
          );
          return !obstruction || obstruction.distance >= edgeDistance - SECTION_PICK_TOLERANCE_MM;
        } finally {
          this.raycaster.ray.copy(savedRay);
        }
      });
      if (hit) {
        const entry = owners.get(hit.object);
        const seg = Math.floor((hit.index ?? 0) / 2);
        id = entry?.segToEdge[seg] ?? null;
      }
    } else {
      const objects = [...this.bodies.values()].flatMap((entry) => [
        ...(entry.sectionCap ? [entry.sectionCap] : []),
        entry.mesh,
      ]);
      const hits = this.raycaster.intersectObjects(objects, false);
      let capDistance = Number.POSITIVE_INFINITY;
      for (const hit of hits) {
        if (hit.object.userData.sectionCut) {
          capDistance = Math.min(capDistance, hit.distance);
          continue;
        }
        if (hit.distance > capDistance + SECTION_PICK_TOLERANCE_MM) break;
        if (!this.isHitVisible(hit)) continue;
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
        else if (this.pickMode === "face") {
          if (face) id = face.persistentFaceId;
        }
        else id = this.pickMode === "auto" && !face ? bodyId : (face ? face.persistentFaceId : null);
        if (id) break;
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
    const started = performance.now();
    this.renderer.render(this.scene, this.camera);
    const elapsed = performance.now() - started;
    ++this.renderedFrames;
    this.renderCpuTotalMs += elapsed;
    this.renderCpuMaxMs = Math.max(this.renderCpuMaxMs, elapsed);
  };
}
