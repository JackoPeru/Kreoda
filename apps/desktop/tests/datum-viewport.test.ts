import { expect, it } from "vitest";
import * as THREE from "three";
import { DatumDescriptorSchema } from "@kreoda/protocol";
import { DatumViewport } from "../src/viewport/DatumViewport";

it("displays and picks native reference identity at its resolved CAD position", () => {
  const view = new DatumViewport();
  const point = DatumDescriptorSchema.parse({ featureId: "native-point", kind: "DatumPoint", definition: { type: "coordinates", positionMm: [10,20,30] }, dependsOn: [], resolved: { positionMm: [10,20,30] }, status: "ok" });
  view.sync([point]);
  const ray = new THREE.Raycaster(new THREE.Vector3(10,20,100),new THREE.Vector3(0,0,-1));
  expect(view.pick(ray)?.id).toBe("native-point");
  view.sync([]);expect(view.pick(ray)).toBeNull();expect(view.group.children).toHaveLength(0);view.dispose();
});
