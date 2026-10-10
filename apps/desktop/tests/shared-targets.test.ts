import { beforeEach, expect, it } from "vitest";
import { useSharedTargetStore, currentSharedTargets } from "../src/model/shared-targets";
import { useSelectionStore } from "../src/stores";

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
