import { beforeEach, expect, it } from "vitest";
import { useSharedTargetStore, currentSharedTargets, visibleSharedTargets } from "../src/model/shared-targets";
import { useSelectionStore } from "../src/stores";
import { DatumDescriptorSchema } from "@kreoda/protocol";

const context = { sessionId: "session-a", documentId: "doc-a", revision: 3 };
const event = { ...context, event: "selection", clientId: "quest", ids: ["box:box.+Z"] };
beforeEach(() => { useSharedTargetStore.getState().reset(); useSelectionStore.getState().clear(); });

it("queues a target arriving before its snapshot and preserves the local selection", () => {
  useSelectionStore.getState().select("local-box", false);
  const state = useSharedTargetStore.getState();
  state.receive(event);
  expect(currentSharedTargets()).toEqual([]);
  state.setContext(context);
  expect(currentSharedTargets()).toEqual([event]);
  expect(useSelectionStore.getState().selectedIds).toEqual(["local-box"]);
});

it("rejects missing identity, stale revisions and old lineages; clear affects one client", () => {
  const state = useSharedTargetStore.getState();
  state.setContext(context);
  state.receive({ event: "selection", clientId: "legacy", ids: ["bad"] });
  state.receive({ ...event, clientId: "old", revision: 2 });
  state.receive(event);
  state.receive({ ...event, clientId: "other", ids: ["other-box"] });
  state.receive({ ...event, ids: [] });
  expect(currentSharedTargets()).toEqual([{ ...event, clientId: "other", ids: ["other-box"] }]);
  state.setContext({ ...context, sessionId: "session-b", revision: 0 });
  expect(currentSharedTargets()).toEqual([]);
  state.receive({ ...event, sessionId: "session-b", revision: 0 });
  state.reset();
  expect(currentSharedTargets()).toEqual([]);
});

it("retains current native datum UUID targets without inventing body IDs", () => {
  const planeId = "67e12d50-c1e9-4c42-9bf8-983de4eb9c25";
  const plane = DatumDescriptorSchema.parse({ featureId: planeId, kind: "DatumPlane",
    definition: { type: "principal", planeKind: "XY" }, dependsOn: [],
    resolved: { originMm: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] }, status: "ok" });
  useSharedTargetStore.getState().setContext(context);
  useSharedTargetStore.getState().receive({ ...event, ids: [planeId, "body-" + planeId] });
  expect(visibleSharedTargets({}, context, [plane])[0]?.ids).toEqual([planeId]);
});

it("drops datum targets on stale view, removal, or ambiguous duplicate identities", () => {
  const planeId = "67e12d50-c1e9-4c42-9bf8-983de4eb9c26";
  const plane = DatumDescriptorSchema.parse({ featureId: planeId, kind: "DatumPlane",
    definition: { type: "principal", planeKind: "XY" }, dependsOn: [],
    resolved: { originMm: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] }, status: "ok" });
  useSharedTargetStore.getState().setContext(context);
  useSharedTargetStore.getState().receive({ ...event, ids: [planeId] });
  expect(visibleSharedTargets({}, { ...context, revision: 4 }, [plane])).toEqual([]);
  expect(visibleSharedTargets({}, context, [])).toEqual([]);
  expect(visibleSharedTargets({}, context, [plane, plane])).toEqual([]);
});
