import { expect, it } from "vitest";
import { buildBodies, visibleFeatureIds, useDocumentUiStore } from "../src/stores";
import { buildSessionBodies, normalizeSnapshot } from "../electron/session-queries";
import type { FeatureSummary } from "../src/ipc/coreClient";

const root: FeatureSummary = { featureId: "box", type: "Box", paramsMm: [10,10,10], dependsOn: [], refExtra: "", expressions: {}, bodyId: "body-box", bodyVisible: false, bodyTip: false };
const tip: FeatureSummary = { featureId: "fillet", type: "Fillet", paramsMm: [1], dependsOn: ["box"], refExtra: "", expressions: {}, bodyId: "body-box", bodyVisible: false, bodyTip: true };
const tool: FeatureSummary = { featureId: "tool", type: "Box", paramsMm: [1,1,1], dependsOn: [], refExtra: "", expressions: {}, bodyId: "body-tool", bodyVisible: true, bodyTip: true };

it("hides only the suppressed tip while retaining full feature and dependency history", () => {
  const features = [root, tip, tool];
  expect(buildBodies(features)).toEqual([
    { bodyId: "body-box", history: ["box", "fillet"], tipFeatureId: "fillet", geometryKind: "solid", visible: false },
    { bodyId: "body-tool", history: ["tool"], tipFeatureId: "tool", geometryKind: "solid", visible: true },
  ]);
  expect(visibleFeatureIds(features)).toEqual(["tool"]);
  useDocumentUiStore.getState().resetDocument("visibility-test");
  useDocumentUiStore.getState().setFeatures(features, 1);
  expect(useDocumentUiStore.getState().features).toHaveLength(3);
  expect(useDocumentUiStore.getState().bodies[0]?.history).toEqual(["box", "fillet"]);
});

it("session bodies transmit native visibility but do not suppress history", () => {
  const snapshot = normalizeSnapshot("doc", 5, [root, tip, tool], []);
  expect(snapshot.bodies).toEqual([
    { bodyId: "body-box", tip: "fillet", history: ["box", "fillet"], visible: false },
    { bodyId: "body-tool", tip: "tool", history: ["tool"], visible: true },
  ]);
  expect(snapshot.features).toHaveLength(3);
  expect(buildSessionBodies(snapshot.features)[0]?.visible).toBe(false);
});
