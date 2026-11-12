import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandType } from "@kreoda/protocol";
import { CoreClient } from "../src/ipc/coreClient";
import { useDocumentUiStore, useSelectionStore } from "../src/stores";

const sessionId = "550e8400-e29b-41d4-a716-446655440000";

function decodeRequest(value: string): Record<string, unknown> {
  const raw = Uint8Array.from(atob(value), char => char.charCodeAt(0));
  const size = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(0, true);
  return JSON.parse(new TextDecoder().decode(raw.subarray(4, 4 + size))) as Record<string, unknown>;
}

function reply(value: Record<string, unknown>): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({
    protocolVersion: 1, requestId: "relay", ...value,
  }))));
}

function face(owner: string, persistentId = owner + ":box.+Z", extra: Record<string, unknown> = {}) {
  return {
    persistentId, captureRevision: 7, ambiguous: false, featureId: owner, owner,
    ownerBody: owner === "instance-a" ? "body-box-a" : "body-" + owner,
    role: "box.+Z", surfaceType: "plane", centroidMm: [1, 2, 3],
    sourceFace: { type: "face", featureId: owner, persistentFaceId: persistentId },
    ...extra,
  };
}

function seed() {
  const store = useDocumentUiStore.getState();
  store.resetDocument("doc-direct");
  store.setCoreStatus(true, "test");
  store.setFeatures([
    { featureId: "box-a", bodyId: "body-box-a", bodyTip: true, bodyVisible: true,
      type: "StepImport", paramsMm: [], dependsOn: [], refExtra: "", expressions: {},
      geometryCurrent: true, status: "ok" },
    { featureId: "instance-a", type: "Instance", paramsMm: [],
      dependsOn: ["box-a"], refExtra: "", expressions: {}, geometryCurrent: true, status: "ok" },
  ], 7);
  useDocumentUiStore.setState({ meshes: { "instance-a": {} as never } });
  useSelectionStore.setState({ selectedIds: ["box-a:box.+Z"] });
  const client = new CoreClient();
  client.documentId = "doc-direct";
  let rows = [face("box-a"), face("instance-a")];
  const invoke = vi.fn(async (encoded: string) => {
    const request = decodeRequest(encoded);
    if (request.type === CommandType.RequestSessionQuery) {
      const featureId = (request.params as Record<string, unknown>).featureId;
      return reply({
        status: "ok", documentId: "doc-direct", sessionId, revision: 7,
        result: { faces: rows.filter(item => item.featureId === featureId) },
      });
    }
    if (request.type === CommandType.CreateMoveFace) {
      useDocumentUiStore.setState({ revision: 9 });
      return reply({
        status: "ok", documentId: "doc-direct", sessionId, revision: 8,
        featureId: "move-a", type: "MoveFace",
        paramsMm: [1, 2, 3, 4, 5, 6, 7, 8, 9], dependsOn: ["box-a"], refExtra: "",
        expressions: {}, bboxMm: [0, 0, 0, 1, 1, 1],
      });
    }
    throw new Error("unexpected native type " + String(request.type));
  });
  Object.defineProperty(window, "kreoda", { configurable: true, value: {
    invoke,
    sessionSnapshot: vi.fn(async () => ({
      sessionId, documentId: "doc-direct", revision: useDocumentUiStore.getState().revision,
    })),
  } });
  return { client, invoke, setRows: (value: ReturnType<typeof face>[]) => { rows = value; } };
}

describe("CoreClient direct face history capture and CAS", () => {
  beforeEach(() => {
    useDocumentUiStore.getState().resetDocument("doc-direct");
    useSelectionStore.getState().clear();
  });
  afterEach(() => { Reflect.deleteProperty(window, "kreoda"); });

  it("captures one exact direct sourceFace and drops any assembly sourceBinding", async () => {
    const { client, invoke, setRows } = seed();
    setRows([face("box-a", "box-a:box.+Z", {
      sourceBinding: { type: "face", featureId: "prototype", persistentFaceId: "box.+Z" },
    })]);
    const context = await client.captureDirectFaceContext();
    const captured = await client.captureDirectFaceSelection("box-a:box.+Z", context, "source");
    const request = decodeRequest(invoke.mock.calls[0]![0] as string);

    expect(request).toMatchObject({
      type: CommandType.RequestSessionQuery, method: "findFaces",
      documentId: "doc-direct", params: { featureId: "box-a" },
      expectedRevision: 7, expectedSessionId: sessionId,
    });
    expect(captured.sourceFace).toEqual({
      type: "face", featureId: "box-a", persistentFaceId: "box-a:box.+Z",
    });
    expect(Object.keys(captured.sourceFace).sort()).toEqual(["featureId", "persistentFaceId", "type"]);
    expect(captured).not.toHaveProperty("sourceBinding");
  });

  it("rejects missing, duplicate, ambiguous, wrong-owner, and stale direct rows", async () => {
    const cases = [
      { name: "missing", rows: [] },
      { name: "duplicate", rows: [face("box-a"), face("box-a")] },
      { name: "ambiguous", rows: [face("box-a", undefined, { ambiguous: true })] },
      { name: "wrong owner", rows: [face("other", "box-a:box.+Z")] },
      { name: "stale revision", rows: [face("box-a", undefined, { captureRevision: 6 })] },
    ];
    for (const item of cases) {
      const { client, setRows } = seed();
      setRows(item.rows);
      const context = await client.captureDirectFaceContext();
      await expect(client.captureDirectFaceSelection("box-a:box.+Z", context, "source"), item.name)
        .rejects.toThrow();
      Reflect.deleteProperty(window, "kreoda");
    }
  });

  it("rejects Instance and historical source tips but accepts a visible solid Instance as Replace support", async () => {
    const { client, setRows } = seed();
    const context = await client.captureDirectFaceContext();
    useSelectionStore.setState({ selectedIds: ["instance-a:box.+Z"] });
    await expect(client.captureDirectFaceSelection("instance-a:box.+Z", context, "source"))
      .rejects.toThrow();

    useSelectionStore.setState({ selectedIds: ["box-a:box.+Z"] });
    useDocumentUiStore.getState().setFeatures([
      { featureId: "box-a", bodyId: "body-box-a", bodyTip: false, type: "StepImport",
        paramsMm: [], dependsOn: [], refExtra: "", expressions: {}, status: "ok" },
      { featureId: "later", bodyId: "body-box-a", bodyTip: true, type: "OffsetFace",
        paramsMm: [-1], dependsOn: ["box-a"], refExtra: "", expressions: {}, status: "ok" },
      { featureId: "instance-a", type: "Instance", paramsMm: [],
        dependsOn: ["box-a"], refExtra: "", expressions: {}, status: "ok" },
    ], 7);
    await expect(client.captureDirectFaceSelection("box-a:box.+Z", context, "source"))
      .rejects.toThrow();

    setRows([face("instance-a")]);
    useSelectionStore.setState({ selectedIds: ["instance-a:box.+Z"] });
    useDocumentUiStore.setState({ meshes: {} });
    await expect(client.captureDirectFaceSelection("instance-a:box.+Z", context, "support"))
      .rejects.toThrow();
    useDocumentUiStore.setState({ meshes: { "instance-a": {} as never } });
    const support = await client.captureDirectFaceSelection("instance-a:box.+Z", context, "support");
    expect(support.sourceFace.featureId).toBe("instance-a");
  });

  it("sends registry command with exact direct DTO and accepts a newer same-session revision", async () => {
    const { client, invoke } = seed();
    const context = await client.captureDirectFaceContext();
    const sourceFace = {
      type: "face" as const, featureId: "box-a", persistentFaceId: "box-a:box.+Z",
    };
    const result = await client.createDirectFaceHistory("CreateMoveFace", {
      sourceFeatureId: "box-a", sourceFace, captureRevision: 7,
      translationMm: { x: 1, y: 2, z: 3 },
      rotationDeg: { x: 4, y: 5, z: 6 }, pivotMm: { x: 7, y: 8, z: 9 },
    }, context);
    const request = decodeRequest(invoke.mock.calls[0]![0] as string);

    expect(request).toMatchObject({
      type: CommandType.CreateMoveFace, sourceFeatureId: "box-a", sourceFace,
      captureRevision: 7, expectedRevision: 7, expectedSessionId: sessionId,
      translationMm: { x: 1, y: 2, z: 3 },
      rotationDeg: { x: 4, y: 5, z: 6 }, pivotMm: { x: 7, y: 8, z: 9 },
    });
    expect(request.sourceFace).not.toHaveProperty("sourceBinding");
    expect(result.revision).toBe(8);
    expect(useDocumentUiStore.getState().revision).toBe(9);
  });

  it("replaces an older direct refresh with full snapshot at renderer revision", async () => {
    const { client, invoke } = seed();
    const context = await client.captureDirectFaceContext();
    useDocumentUiStore.setState({ revision: 9 });
    invoke.mockImplementationOnce(async () => reply({
      status: "ok", documentId: "doc-direct", sessionId, revision: 8,
      features: useDocumentUiStore.getState().features, sketches: [], datums: [],
    }));
    const sessionSnapshot = window.kreoda.sessionSnapshot as ReturnType<typeof vi.fn>;
    sessionSnapshot.mockResolvedValueOnce({ sessionId, documentId: "doc-direct", revision: 9 });
    sessionSnapshot.mockResolvedValueOnce({
      sessionId, documentId: "doc-direct", revision: 9,
      features: useDocumentUiStore.getState().features, sketches: [], datums: [],
    });

    const snapshot = await client.requestDirectFaceHistorySnapshot(context, 8);
    expect(snapshot.revision).toBe(9);
    expect(useDocumentUiStore.getState().revision).toBe(9);
  });

  it("rejects a capture whose viewport selection changes before the response", async () => {
    const { client, invoke } = seed();
    let release!: (value: string) => void;
    invoke.mockImplementationOnce(async () => new Promise<string>(resolve => { release = resolve; }));
    const context = await client.captureDirectFaceContext();
    const pending = client.captureDirectFaceSelection("box-a:box.+Z", context, "source");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    useSelectionStore.setState({ selectedIds: ["box-a:box.-Z"] });
    release(reply({
      status: "ok", documentId: "doc-direct", sessionId, revision: 7,
      result: { faces: [face("box-a")] },
    }));
    await expect(pending).rejects.toThrow(/stale|scadut/i);
  });
});
