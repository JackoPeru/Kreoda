import { afterEach, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { SharedTargetChip } from "../src/components/workspace/SharedTargetChip";
import { useSharedTargetStore, visibleSharedTargets } from "../src/model/shared-targets";
import { useDocumentUiStore, useSelectionStore } from "../src/stores";
import type { CoreMeshData } from "@kreoda/protocol";

afterEach(() => { cleanup(); useSharedTargetStore.getState().reset(); useSelectionStore.getState().clear(); });

it("renders only resolvable current remote refs and hides immediately when Desktop revision changes", () => {
  const context = { sessionId: "session-a", documentId: "doc-a", revision: 3 };
  const mesh: CoreMeshData = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array(9), indices: new Uint32Array([0, 1, 2]),
    edgeVertices: new Float32Array(), edges: [], faces: [{ persistentFaceId: "box:face", triangleStart: 0, triangleCount: 1 }],
    bboxMm: [0, 0, 0, 1, 1, 0], volumeMm3: 0, triangleCount: 1, revision: 3 };
  useDocumentUiStore.setState({ documentId: context.documentId, revision: 3, meshes: { box: mesh } });
  useSharedTargetStore.getState().setContext(context);
  useSelectionStore.getState().select("local", false);
  render(<SharedTargetChip />);
  act(() => useSharedTargetStore.getState().receive({ ...context, event: "selection", clientId: "quest",
    ids: ["box:face", "unresolved"] }));
  expect(screen.getByTestId("shared-target-chip").textContent).toContain("box:face");
  expect(screen.getByTestId("shared-target-chip").textContent).not.toContain("unresolved");
  expect(visibleSharedTargets({ box: mesh })[0]?.ids).toEqual(["box:face"]);
  expect(useSelectionStore.getState().selectedIds).toEqual(["local"]);
  act(() => useDocumentUiStore.setState({ revision: 4 }));
  expect(screen.queryByTestId("shared-target-chip")).toBeNull();
});
