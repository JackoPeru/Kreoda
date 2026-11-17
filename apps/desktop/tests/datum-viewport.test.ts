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

it("highlights a remote datum UUID on its native-position guide independently of solids", () => {
  const view = new DatumViewport();
  const plane = DatumDescriptorSchema.parse({ featureId: "native-plane", kind: "DatumPlane",
    definition: { type: "principal", planeKind: "XY" }, dependsOn: [],
    resolved: { originMm: [10, 20, 30], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] }, status: "ok" });
  view.sync([plane]);
  expect(typeof (view as unknown as { setSharedTargets?: unknown }).setSharedTargets).toBe("function");
  const holder = view.group.children[0]!;
  expect(holder.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([10, 20, 30]);
  (view as unknown as { setSharedTargets(ids: string[]): void }).setSharedTargets(["native-plane"]);
  const border = holder.children.find(object => object instanceof THREE.Line) as THREE.Line;
  expect((border.material as THREE.LineBasicMaterial).color.getHex()).toBe(0x4bcab0);
  view.setSelection(["native-plane"], null);
  expect((border.material as THREE.LineBasicMaterial).color.getHex()).toBe(0xffcf65);
  view.setSelection([], "native-plane");
  expect((border.material as THREE.LineBasicMaterial).color.getHex()).toBe(0xffcf65);
  view.setSelection([], null);
  expect((border.material as THREE.LineBasicMaterial).color.getHex()).toBe(0x4bcab0);
  const broken = DatumDescriptorSchema.parse({ ...plane, featureId: "broken-plane", status: "broken" });
  view.sync([broken]);
  view.setSharedTargets(["broken-plane"]);
  const brokenBorder = view.group.children[0]!.children.find(object => object instanceof THREE.Line) as THREE.Line;
  expect((brokenBorder.material as THREE.LineBasicMaterial).color.getHex()).toBe(0xff7070);
  view.dispose();
});
