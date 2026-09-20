import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CameraController } from "../src/viewport/CameraController";

function harness() {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 20000);
  const dom = document.createElement("div");
  const ctl = new CameraController(camera, dom);
  return { camera, dom, ctl };
}

describe("CameraController (§23)", () => {
  it("frames all on demand without Euler exposure", () => {
    const { camera, ctl } = harness();
    ctl.frameAll(420);
    expect(camera.position.distanceTo(new THREE.Vector3(0, 0, 0))).toBeCloseTo(
      420,
      0,
    );
  });

  it("frames a selection conservatively", () => {
    const { camera, ctl } = harness();
    ctl.frameSelection(new THREE.Vector3(10, 0, 5), 20);
    expect(camera.position.distanceTo(new THREE.Vector3(10, 0, 5))).toBeGreaterThan(
      59.9,
    );
  });
});
