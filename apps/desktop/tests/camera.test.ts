import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CameraController } from "../src/viewport/CameraController";

function harness(opts: ConstructorParameters<typeof CameraController>[2] = {}) {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 20000);
  const dom = document.createElement("div");
  const touchAction = dom.style.touchAction;
  const ctl = new CameraController(camera, dom, opts);
  return { camera, dom, ctl, touchAction };
}

function pointer(dom: HTMLElement, type: string, opts: {
  x?: number; y?: number; button?: number; shiftKey?: boolean; pointerId?: number;
} = {}): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: opts.x ?? 0,
    clientY: opts.y ?? 0,
    button: opts.button ?? 0,
    shiftKey: opts.shiftKey ?? false,
  });
  Object.defineProperty(event, "pointerId", { value: opts.pointerId ?? 1 });
  dom.dispatchEvent(event);
  return event;
}

describe("CameraController", () => {
  it("frames the supplied model center at a useful distance", () => {
    const { camera, ctl } = harness();
    const center = new THREE.Vector3(15, 20, 30);
    ctl.frameAll(420, center);
    expect(camera.position.distanceTo(center)).toBeCloseTo(420, 0);
    expect(ctl.viewDir().dot(center.clone().sub(camera.position).normalize())).toBeCloseTo(1);
  });

  it("Home preserves camera direction when framing far off-origin content", () => {
    const center = new THREE.Vector3(42000, -31500, 18000);
    let frameAll = () => {};
    const { camera, dom, ctl } = harness({ onFrameAll: () => frameAll() });
    frameAll = () => ctl.frameAll(420, center);
    const directionBefore = camera.position.clone().normalize();

    dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));

    const directionAfter = camera.position.clone().sub(center).normalize();
    expect(directionAfter.dot(directionBefore)).toBeCloseTo(1, 10);
    expect(camera.position.distanceTo(center)).toBeCloseTo(420, 8);
  });

  it("frames selection bounds conservatively", () => {
    const { camera, ctl } = harness();
    ctl.frameSelection(new THREE.Vector3(10, 0, 5), 20);
    expect(camera.position.distanceTo(new THREE.Vector3(10, 0, 5))).toBeGreaterThan(59.9);
  });

  it("fits selection bounds inside a narrow viewport", () => {
    const { camera, ctl } = harness();
    camera.aspect = 0.4;
    const center = new THREE.Vector3(10, 0, 5);
    const radius = 20;
    ctl.frameSelection(center, radius);
    const limitingHalfFov = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
    expect(camera.position.distanceTo(center)).toBeGreaterThanOrEqual(radius / Math.sin(limitingHalfFov) * 1.15 - 1e-9);
  });

  it("F preserves camera direction and fit distance for far off-origin selection bounds", () => {
    const center = new THREE.Vector3(-52000, 28000, 37000);
    const radius = 80;
    let frameSelection = () => {};
    const { camera, dom, ctl } = harness({ onFrameSelection: () => frameSelection() });
    camera.aspect = 0.4;
    frameSelection = () => ctl.frameSelection(center, radius);
    const directionBefore = camera.position.clone().normalize();
    const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * camera.aspect);
    const expectedDistance = radius / Math.sin(Math.min(verticalHalfFov, horizontalHalfFov)) * 1.15;

    dom.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true, cancelable: true }));

    const directionAfter = camera.position.clone().sub(center).normalize();
    expect(directionAfter.dot(directionBefore)).toBeCloseTo(1, 10);
    expect(camera.position.distanceTo(center)).toBeCloseTo(expectedDistance, 8);
  });

  it("left-drag orbits with Z up and consumes synthesized clicks", () => {
    const { dom, ctl } = harness();
    const before = ctl.viewDir();
    pointer(dom, "pointerdown", { button: 0 });
    expect(ctl.isNavigating()).toBe(true);
    pointer(dom, "pointermove", { x: 20, y: 5 });
    pointer(dom, "pointerup", { x: 20, y: 5 });
    expect(ctl.viewDir().distanceTo(before)).toBeGreaterThan(0.01);
    expect(ctl.isNavigating()).toBe(false);
    expect(ctl.consumeClick()).toBe(true);
    expect(ctl.consumeClick()).toBe(false);
  });

  it("does not consume a left click after right-pan, but does after a primary drag", () => {
    const { dom, ctl } = harness();
    pointer(dom, "pointerdown", { button: 2, pointerId: 1 });
    pointer(dom, "pointermove", { x: 20, y: 10, button: 2, pointerId: 1 });
    pointer(dom, "pointerup", { x: 20, y: 10, button: 2, pointerId: 1 });

    // Browser's next left click is a separate, non-dragging pointer sequence.
    pointer(dom, "pointerdown", { button: 0, pointerId: 2 });
    pointer(dom, "pointerup", { button: 0, pointerId: 2 });
    expect(ctl.consumeClick()).toBe(false);

    pointer(dom, "pointerdown", { button: 0, pointerId: 3 });
    pointer(dom, "pointermove", { x: 20, y: 5, button: 0, pointerId: 3 });
    pointer(dom, "pointerup", { x: 20, y: 5, button: 0, pointerId: 3 });
    expect(ctl.consumeClick()).toBe(true);
  });

  it("right and Shift-left drags pan without changing view direction", () => {
    const { camera, dom, ctl } = harness();
    const before = ctl.viewDir();
    const position = camera.position.clone();
    pointer(dom, "pointerdown", { button: 2 });
    pointer(dom, "pointermove", { x: 20, y: 10, button: 2 });
    pointer(dom, "pointerup", { x: 20, y: 10, button: 2 });
    expect(camera.position.distanceTo(position)).toBeGreaterThan(0.1);
    expect(ctl.viewDir().distanceTo(before)).toBeLessThan(1e-8);
    expect(ctl.consumeClick()).toBe(false);

    const afterRightPan = camera.position.clone();
    pointer(dom, "pointerdown", { button: 0, x: 5, y: 5, shiftKey: true });
    pointer(dom, "pointermove", { button: 0, x: 25, y: 15, shiftKey: true });
    pointer(dom, "pointerup", { button: 0, x: 25, y: 15, shiftKey: true });
    expect(camera.position.distanceTo(afterRightPan)).toBeGreaterThan(0.1);
    expect(ctl.viewDir().distanceTo(before)).toBeLessThan(1e-8);
    expect(ctl.consumeClick()).toBe(true);
  });

  it("ignores sub-threshold motion, respects input ownership, and cleans canceled pointers", () => {
    const { camera, dom, ctl } = harness();
    const before = camera.position.clone();
    pointer(dom, "pointerdown");
    pointer(dom, "pointermove", { x: 2, y: 2 });
    pointer(dom, "pointerup", { x: 2, y: 2 });
    expect(camera.position.distanceTo(before)).toBe(0);
    expect(ctl.consumeClick()).toBe(false);

    ctl.inputEnabled = false;
    pointer(dom, "pointerdown");
    pointer(dom, "pointermove", { x: 20, y: 20 });
    pointer(dom, "pointerup", { x: 20, y: 20 });
    expect(camera.position.distanceTo(before)).toBe(0);
    ctl.inputEnabled = true;

    pointer(dom, "pointerdown");
    pointer(dom, "pointercancel");
    expect(ctl.isNavigating()).toBe(false);
    expect(camera.position.distanceTo(before)).toBe(0);
  });

  it("zooms, prevents the context menu, and routes F/Home to framing callbacks", () => {
    let framedSelection = 0;
    let framedAll = 0;
    const { camera, dom } = harness({
      onFrameSelection: () => framedSelection++,
      onFrameAll: () => framedAll++,
    });
    const before = camera.position.length();
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 100 });
    dom.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(camera.position.length()).toBeGreaterThan(before);
    const context = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    dom.dispatchEvent(context);
    expect(context.defaultPrevented).toBe(true);
    dom.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true, cancelable: true }));
    dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
    expect(framedSelection).toBe(1);
    expect(framedAll).toBe(1);
  });

  it("removes all input handlers on dispose", () => {
    const { camera, dom, ctl, touchAction } = harness();
    ctl.dispose();
    const before = camera.position.clone();
    pointer(dom, "pointerdown");
    pointer(dom, "pointermove", { x: 20, y: 10 });
    pointer(dom, "pointerup", { x: 20, y: 10 });
    expect(camera.position.distanceTo(before)).toBe(0);
    expect(dom.style.touchAction).toBe(touchAction);
    const wheel = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
    dom.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
  });
});
