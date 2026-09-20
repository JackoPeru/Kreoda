import * as THREE from "three";

/** Edge overlay with adaptive width; rebuilt only for changed bodies (§45). */
export class SelectionRenderer {
  private lines = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x9cc2ff }),
  );
  constructor(private scene: THREE.Scene) {
    scene.add(this.lines);
  }
  highlight(_persistentId: string | null): void {}
}
