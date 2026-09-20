// CameraController (§23): simpler-than-Blender defaults.
// empty-background drag = orbit, Shift+drag = pan, wheel = zoom,
// double-click/F = frame selection, Home = frame all. No Euler exposure.

import * as THREE from "three";

export class CameraController {
  /** False while a manipulator drag owns the pointer (no orbit fighting). */
  inputEnabled = true;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private target = new THREE.Vector3(0, 0, 0);

  constructor(
    private camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
  ) {
    this.camera.position.set(160, -180, 140);
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(this.target);
    this.bind();
  }

  frameAll(distance = 420): void {
    this.target.set(0, 0, 0);
    const dir = this.camera.position.clone().sub(this.target).normalize();
    this.camera.position.copy(this.target).addScaledVector(dir, distance);
    this.camera.lookAt(this.target);
  }

  frameSelection(center: THREE.Vector3, radius: number): void {
    this.target.copy(center);
    const dir = this.camera.position.clone().sub(this.target).normalize();
    this.camera.position
      .copy(this.target)
      .addScaledVector(dir, Math.max(radius * 3, 60));
    this.camera.lookAt(this.target);
  }

  /** Normalized view direction (target − position) for tests/diagnostics. */
  viewDir(): THREE.Vector3 {
    return this.target
      .clone()
      .sub(this.camera.position)
      .normalize();
  }

  /** Pan-target distance (correct depth reference for drag gain, M2). */
  distanceToTarget(): number {
    return this.camera.position.distanceTo(this.target);
  }
  /** Named view presets (§23 view cube). No Euler exposure to users. */
  setView(name: "top" | "front" | "right" | "iso" | "bottom" | "back" | "left"): void {
    // Shared zoom-range clamp so presets agree with zoom/frame paths (M1).
    const d = this.camera.position.distanceTo(this.target);
    const dist = THREE.MathUtils.clamp(d, 20, 4000);
    const dirs: Record<string, THREE.Vector3> = {
      top: new THREE.Vector3(0, 0, 1),
      bottom: new THREE.Vector3(0, 0, -1),
      front: new THREE.Vector3(0, -1, 0),
      back: new THREE.Vector3(0, 1, 0),
      right: new THREE.Vector3(1, 0, 0),
      left: new THREE.Vector3(-1, 0, 0),
      iso: new THREE.Vector3(1, -1, 1).normalize(),
    };
    const dir = dirs[name] ?? dirs.iso!;
    // Straight down/up degenerates lookAt with up=+Z. Park epsilon off-pole
    // instead of flipping up: the baked quaternion then always matches +Z up
    // and later pan/zoom/frame lookAts stay non-singular (C4).
    const axial = name === "top" || name === "bottom";
    const tilt = axial ? new THREE.Vector3(0, 0.002, name === "top" ? 1 : -1).normalize() : dir;
    this.camera.up.set(0, 0, 1);
    this.camera.position.copy(this.target).addScaledVector(tilt, dist);
    this.camera.lookAt(this.target);
  }

  dispose(): void {
    // Listeners are GC'd with the canvas in Phase 0 (named handlers in V1).
  }

  private bind(): void {
    this.dom.addEventListener("pointerdown", (e) => {
      if (!this.inputEnabled) return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.dom.setPointerCapture(e.pointerId);
    });
    this.dom.addEventListener("pointerup", () => {
      this.dragging = false;
    });
    this.dom.addEventListener("pointermove", (e) => {
      if (!this.inputEnabled || !this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (e.shiftKey) this.pan(dx, dy);
      else this.orbit(dx, dy);
    });
    this.dom.addEventListener("wheel", (e) => {
      if (!this.inputEnabled) return;
      e.preventDefault();
      this.zoom(e.deltaY);
    });
    this.dom.addEventListener("dblclick", () => this.frameAll());
    this.dom.addEventListener("keydown", (e) => {
      if (e.key === "f" || e.key === "F") this.frameAll(300);
      if (e.key === "Home") this.frameAll();
    });
  }

  private orbit(dx: number, dy: number): void {
    const off = this.camera.position.clone().sub(this.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    sph.theta -= dx * 0.005;
    sph.phi = THREE.MathUtils.clamp(sph.phi - dy * 0.005, 0.05, Math.PI - 0.05);
    this.camera.position.copy(this.target).add(new THREE.Vector3().setFromSpherical(sph));
    this.camera.lookAt(this.target);
  }

  private pan(dx: number, dy: number): void {
    const scale = this.camera.position.distanceTo(this.target) / 800;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    this.target.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
    this.camera.position
      .addScaledVector(right, -dx * scale)
      .addScaledVector(up, dy * scale);
    this.camera.lookAt(this.target);
  }

  private zoom(deltaY: number): void {
    const off = this.camera.position.clone().sub(this.target);
    const factor = Math.exp(deltaY * 0.001);
    const len = THREE.MathUtils.clamp(off.length() * factor, 20, 4000);
    off.setLength(len);
    this.camera.position.copy(this.target).add(off);
    this.camera.lookAt(this.target);
  }
}
