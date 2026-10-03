// Left drag orbits; right/middle/Shift drag pans; wheel zooms.

import * as THREE from "three";

type ViewName = "top" | "front" | "right" | "iso" | "bottom" | "back" | "left";

export class CameraController {
  /** False while a manipulator owns pointer input. */
  inputEnabled = true;
  private activePointer: number | null = null;
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private pointerButton = 0;
  private dragging = false;
  private navigationMoved = false;
  private blockedClickUntil = 0;
  private target = new THREE.Vector3(0, 0, 0);
  private onChange: () => void = () => {};
  private onFrameAll: (() => void) | undefined;
  private onFrameSelection: (() => void) | undefined;
  private previousTouchAction: string;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
    opts: {
      onChange?: () => void;
      onFrameAll?: () => void;
      onFrameSelection?: () => void;
    } = {},
  ) {
    if (opts.onChange) this.onChange = opts.onChange;
    this.onFrameAll = opts.onFrameAll;
    this.onFrameSelection = opts.onFrameSelection;
    this.previousTouchAction = dom.style.touchAction;
    this.dom.style.touchAction = "none";
    this.camera.position.set(160, -180, 140);
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(this.target);
    this.bind();
  }

  /** True while a pointer gesture owns viewport navigation. */
  isNavigating(): boolean {
    return this.dragging;
  }

  /** Consume browser click synthesized after a camera drag, if any. */
  consumeClick(): boolean {
    const blocked = performance.now() <= this.blockedClickUntil;
    this.blockedClickUntil = 0;
    return blocked;
  }

  cancelGesture(): void {
    this.cancelPointer();
  }

  frameAll(distance = 420, center = new THREE.Vector3()): void {
    let dir = this.camera.position.clone().sub(this.target);
    if (dir.lengthSq() < 1e-12) dir.set(1, -1, 1);
    dir.normalize();
    this.target.copy(center);
    this.camera.position.copy(this.target).addScaledVector(dir, distance);
    this.camera.lookAt(this.target);
    this.onChange();
  }

  frameSelection(center: THREE.Vector3, radius: number): void {
    let dir = this.camera.position.clone().sub(this.target);
    if (dir.lengthSq() < 1e-12) dir.set(1, -1, 1);
    dir.normalize();
    this.target.copy(center);
    const vertical = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const horizontal = Math.atan(Math.tan(vertical) * Math.max(1e-3, this.camera.aspect));
    const halfFov = Math.min(vertical, horizontal);
    const safeRadius = Number.isFinite(radius) ? Math.max(0, radius) : 0;
    this.camera.position
      .copy(this.target)
      .addScaledVector(dir, Math.max(safeRadius / Math.sin(halfFov) * 1.15, 60));
    this.camera.lookAt(this.target);
    this.onChange();
  }

  /** Normalized view direction (target − position) for tests/diagnostics. */
  viewDir(): THREE.Vector3 {
    return this.target.clone().sub(this.camera.position).normalize();
  }

  /** Pan-target distance (correct depth reference for drag gain). */
  distanceToTarget(): number {
    return this.camera.position.distanceTo(this.target);
  }

  /** Named view presets. */
  setView(name: ViewName): void {
    const dist = THREE.MathUtils.clamp(this.distanceToTarget(), 20, 4000);
    const dirs: Record<ViewName, THREE.Vector3> = {
      top: new THREE.Vector3(0, 0, 1),
      bottom: new THREE.Vector3(0, 0, -1),
      front: new THREE.Vector3(0, -1, 0),
      back: new THREE.Vector3(0, 1, 0),
      right: new THREE.Vector3(1, 0, 0),
      left: new THREE.Vector3(-1, 0, 0),
      iso: new THREE.Vector3(1, -1, 1).normalize(),
    };
    const axial = name === "top" || name === "bottom";
    const dir = axial
      ? new THREE.Vector3(0, 0.002, name === "top" ? 1 : -1).normalize()
      : dirs[name];
    this.camera.up.set(0, 0, 1);
    this.camera.position.copy(this.target).addScaledVector(dir, dist);
    this.camera.lookAt(this.target);
    this.onChange();
  }

  dispose(): void {
    this.dom.removeEventListener("pointerdown", this.handlePointerDown);
    this.dom.removeEventListener("pointermove", this.handlePointerMove);
    this.dom.removeEventListener("pointerup", this.handlePointerUp);
    this.dom.removeEventListener("pointercancel", this.handlePointerCancel);
    this.dom.removeEventListener("lostpointercapture", this.handleLostPointerCapture);
    this.dom.removeEventListener("wheel", this.handleWheel);
    this.dom.removeEventListener("contextmenu", this.handleContextMenu);
    this.dom.removeEventListener("dblclick", this.handleDoubleClick);
    this.dom.removeEventListener("keydown", this.handleKeyDown);
    this.cancelPointer();
    this.dom.style.touchAction = this.previousTouchAction;
  }

  private bind(): void {
    this.dom.addEventListener("pointerdown", this.handlePointerDown);
    this.dom.addEventListener("pointermove", this.handlePointerMove);
    this.dom.addEventListener("pointerup", this.handlePointerUp);
    this.dom.addEventListener("pointercancel", this.handlePointerCancel);
    this.dom.addEventListener("lostpointercapture", this.handleLostPointerCapture);
    this.dom.addEventListener("wheel", this.handleWheel, { passive: false });
    this.dom.addEventListener("contextmenu", this.handleContextMenu);
    this.dom.addEventListener("dblclick", this.handleDoubleClick);
    this.dom.addEventListener("keydown", this.handleKeyDown);
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (!this.inputEnabled || this.activePointer !== null || ![0, 1, 2].includes(event.button)) return;
    this.activePointer = event.pointerId;
    this.pointerButton = event.button;
    this.startX = this.lastX = event.clientX;
    this.startY = this.lastY = event.clientY;
    this.dragging = true;
    this.navigationMoved = false;
    try {
      this.dom.focus({ preventScroll: true });
      this.dom.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic and detached DOMs may not implement pointer capture.
    }
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointer) return;
    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    if (!this.inputEnabled || this.navigationMoved === false &&
      Math.hypot(event.clientX - this.startX, event.clientY - this.startY) < 4) return;
    this.navigationMoved = true;
    if (this.pointerButton !== 0 || event.shiftKey) this.pan(dx, dy);
    else this.orbit(dx, dy);
    event.preventDefault();
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointer) return;
    if (this.navigationMoved && this.pointerButton === 0) {
      this.blockedClickUntil = performance.now() + 100;
    }
    // The browser releases pointer capture after dispatching pointerup. Keep
    // it through bubbling so viewport manipulators receive the same event.
    this.activePointer = null;
    this.dragging = false;
    this.navigationMoved = false;
  };

  private handlePointerCancel = (event: PointerEvent): void => {
    if (event.pointerId === this.activePointer) this.cancelPointer();
  };

  private handleLostPointerCapture = (event: PointerEvent): void => {
    if (event.pointerId === this.activePointer) this.cancelPointer();
  };

  private cancelPointer(): void {
    const pointer = this.activePointer;
    this.activePointer = null;
    this.dragging = false;
    this.navigationMoved = false;
    if (pointer === null) return;
    try {
      if (this.dom.hasPointerCapture(pointer)) this.dom.releasePointerCapture(pointer);
    } catch {
      // Capture may already have been lost by the browser.
    }
  }

  private handleWheel = (event: WheelEvent): void => {
    if (!this.inputEnabled) return;
    event.preventDefault();
    this.zoom(event.deltaY);
  };

  private handleContextMenu = (event: MouseEvent): void => event.preventDefault();

  private handleDoubleClick = (event: MouseEvent): void => {
    event.preventDefault();
    (this.onFrameAll ?? (() => this.frameAll()))();
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key.toLowerCase() === "f" && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      (this.onFrameSelection ?? (() => this.frameAll(300)))();
    } else if (event.key === "Home") {
      event.preventDefault();
      (this.onFrameAll ?? (() => this.frameAll()))();
    }
  };

  private orbit(dx: number, dy: number): void {
    const offset = this.camera.position.clone().sub(this.target);
    const radius = Math.max(offset.length(), 1e-6);
    // THREE.Spherical is Y-up; CAD camera is Z-up, so compute azimuth/polar directly.
    const azimuth = Math.atan2(offset.y, offset.x) - dx * 0.005;
    const polar = THREE.MathUtils.clamp(
      Math.acos(THREE.MathUtils.clamp(offset.z / radius, -1, 1)) - dy * 0.005,
      0.05,
      Math.PI - 0.05,
    );
    this.camera.position.set(
      this.target.x + radius * Math.sin(polar) * Math.cos(azimuth),
      this.target.y + radius * Math.sin(polar) * Math.sin(azimuth),
      this.target.z + radius * Math.cos(polar),
    );
    this.camera.lookAt(this.target);
    this.onChange();
  }

  private pan(dx: number, dy: number): void {
    const scale = this.distanceToTarget() / 800;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this.target.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
    this.camera.position.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
    this.camera.lookAt(this.target);
    this.onChange();
  }

  private zoom(deltaY: number): void {
    const offset = this.camera.position.clone().sub(this.target);
    const factor = Math.exp(deltaY * 0.001);
    offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, 20, 4000));
    this.camera.position.copy(this.target).add(offset);
    this.camera.lookAt(this.target);
    this.onChange();
  }
}
