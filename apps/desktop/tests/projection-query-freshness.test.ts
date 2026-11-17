import { beforeEach, expect, it, vi } from "vitest";
import type { SketchProjectionResult } from "@kreoda/protocol";

const mockCore = vi.hoisted(() => ({ documentId: "doc", requestSketchProjection: vi.fn() }));
vi.mock("../src/ipc/coreClient", () => ({ coreClient: mockCore }));

import { coreClient } from "../src/ipc/coreClient";
import { refreshSketchProjection } from "../src/model/sync";
import { useDocumentUiStore } from "../src/stores";

let lineage = { sessionId: "session-a", documentId: "doc", revision: 7 };

function result(x: number): { documentId: string; revision: number; projection: SketchProjectionResult } {
  return {
    documentId: "doc", revision: 7,
    projection: { featureId: "target", plane: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
      geometryCurrent: true, status: "ok", error: "", blockingSourceIds: [], groups: [{
        groupId: "group", generation: 1, definition: { version: 1, operation: "silhouette", sources: [{ type: "shape", featureId: "solid" }] },
        sourceFeatureIds: ["solid"], status: "ok", error: "", blockingSourceIds: [], edges: [{
          memberIndex: 0, curveType: "line", firstParameter: 0, lastParameter: 1, closed: false,
          pointsMm: [[x, 0, 0], [x + 1, 0, 0]],
        }],
      }] },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  lineage = { sessionId: "session-a", documentId: "doc", revision: 7 };
  coreClient.documentId = "doc";
  useDocumentUiStore.getState().resetDocument("doc");
  useDocumentUiStore.getState().setFeatures([], 7);
  useDocumentUiStore.getState().setSketches([{ featureId: "target", planeKind: "XY", points: 0, lines: 0, circles: 0,
    constraints: 0, projectionGroups: [] }], 7);
  mockCore.requestSketchProjection.mockReset();
  Object.defineProperty(window, "kreoda", { configurable: true, value: {
    sessionSnapshot: vi.fn(async () => ({ ...lineage })),
  } });
});

it("drops projection replies when document or revision changes", async () => {
  const pending = deferred<ReturnType<typeof result>>();
  mockCore.requestSketchProjection.mockReturnValue(pending.promise);
  const request = refreshSketchProjection("target");
  await vi.waitFor(() => expect(mockCore.requestSketchProjection).toHaveBeenCalledOnce());
  lineage = { ...lineage, revision: 8 };
  useDocumentUiStore.getState().setFeatures([], 8);
  pending.resolve(result(10));
  expect(await request).toBeNull();
  expect(useDocumentUiStore.getState().projectionViews).toEqual({});

  useDocumentUiStore.getState().setFeatures([], 9);
  lineage = { ...lineage, revision: 9 };
  const switched = deferred<ReturnType<typeof result>>();
  mockCore.requestSketchProjection.mockReturnValueOnce(switched.promise);
  const second = refreshSketchProjection("target");
  await vi.waitFor(() => expect(mockCore.requestSketchProjection).toHaveBeenCalledTimes(2));
  useDocumentUiStore.getState().resetDocument("other");
  coreClient.documentId = "other";
  lineage = { sessionId: "session-b", documentId: "other", revision: 0 };
  switched.resolve(result(20));
  expect(await second).toBeNull();
  expect(useDocumentUiStore.getState().projectionViews).toEqual({});
});

it("drops projection replies when session lineage or connection generation changes", async () => {
  const sessionChange = deferred<ReturnType<typeof result>>();
  mockCore.requestSketchProjection.mockReturnValueOnce(sessionChange.promise);
  const first = refreshSketchProjection("target");
  await vi.waitFor(() => expect(mockCore.requestSketchProjection).toHaveBeenCalledOnce());
  lineage = { ...lineage, sessionId: "session-b" };
  sessionChange.resolve(result(30));
  expect(await first).toBeNull();

  lineage = { sessionId: "session-b", documentId: "doc", revision: 7 };
  useDocumentUiStore.getState().resetDocument("doc");
  useDocumentUiStore.getState().setFeatures([], 7);
  useDocumentUiStore.getState().setSketches([{ featureId: "target", planeKind: "XY", points: 0, lines: 0, circles: 0,
    constraints: 0, projectionGroups: [] }], 7);
  const reconnect = deferred<ReturnType<typeof result>>();
  mockCore.requestSketchProjection.mockReturnValueOnce(reconnect.promise);
  const second = refreshSketchProjection("target");
  await vi.waitFor(() => expect(mockCore.requestSketchProjection).toHaveBeenCalledTimes(2));
  useDocumentUiStore.getState().advanceConnectionGeneration();
  reconnect.resolve(result(40));
  expect(await second).toBeNull();
  expect(useDocumentUiStore.getState().projectionViews).toEqual({});
});

it("keeps newest target result when older reply or failure finishes last", async () => {
  const older = deferred<ReturnType<typeof result>>();
  const newer = deferred<ReturnType<typeof result>>();
  mockCore.requestSketchProjection.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  const first = refreshSketchProjection("target");
  await vi.waitFor(() => expect(mockCore.requestSketchProjection).toHaveBeenCalledOnce());
  const second = refreshSketchProjection("target");
  await vi.waitFor(() => expect(mockCore.requestSketchProjection).toHaveBeenCalledTimes(2));

  newer.resolve(result(22));
  expect(await second).toMatchObject({ groups: [{ edges: [{ pointsMm: [[22, 0, 0], [23, 0, 0]] }] }] });
  older.reject(new Error("late stale failure"));
  await expect(first).rejects.toThrow("late stale failure");
  expect(useDocumentUiStore.getState().projectionViews.target?.projection.groups[0]?.edges[0]?.pointsMm[0]).toEqual([22, 0, 0]);
});

it("clears previously displayed lines when latest projection query fails", async () => {
  useDocumentUiStore.getState().setProjectionView({ documentId: "doc", sessionId: "session-a", revision: 7,
    epoch: useDocumentUiStore.getState().epoch, connectionGeneration: useDocumentUiStore.getState().connectionGeneration,
    projection: result(1).projection });
  mockCore.requestSketchProjection.mockRejectedValueOnce(new Error("native query failed"));
  await expect(refreshSketchProjection("target")).rejects.toThrow("native query failed");
  expect(useDocumentUiStore.getState().projectionViews.target).toBeUndefined();
});
