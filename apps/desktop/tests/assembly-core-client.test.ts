import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandType } from "@kreoda/protocol";
import { CoreClient } from "../src/ipc/coreClient";
import { useDocumentUiStore, useSelectionStore } from "../src/stores";

const sessionId = "550e8400-e29b-41d4-a716-446655440000";
const movingBinding = { type: "face", featureId: "part-a", persistentFaceId: "box.+Z", geometryKind: "plane" };
const fixedBinding = { type: "face", featureId: "part-b", persistentFaceId: "box.+Z", geometryKind: "plane" };

function decodeRequest(value: string): Record<string, unknown> {
  const raw = Uint8Array.from(atob(value), char => char.charCodeAt(0));
  const size = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(0, true);
  return JSON.parse(new TextDecoder().decode(raw.subarray(4, 4 + size))) as Record<string, unknown>;
}

function reply(value: Record<string, unknown>): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ protocolVersion: 1, requestId: "relay", ...value }))));
}

function seed() {
  const store = useDocumentUiStore.getState();
  store.resetDocument("doc-mates");
  store.setCoreStatus(true);
  store.setFeatures([
    { featureId: "part-a", type: "Box", paramsMm: [], dependsOn: [], refExtra: "", expressions: {} },
    { featureId: "part-b", type: "Box", paramsMm: [], dependsOn: [], refExtra: "", expressions: {} },
    { featureId: "instance-a", type: "Instance", paramsMm: [], dependsOn: ["part-a"], refExtra: "", expressions: {} },
    { featureId: "instance-b", type: "Instance", paramsMm: [], dependsOn: ["part-b"], refExtra: "", expressions: {} },
  ], 7);
  useSelectionStore.setState({ selectedIds: ["instance-a:box.+Z"] });
  const client = new CoreClient();
  client.documentId = "doc-mates";
  const invoke = vi.fn(async (encoded: string) => {
    const request = decodeRequest(encoded);
    if (request["type"] === CommandType.RequestSessionQuery) {
      const id = (request["params"] as Record<string, unknown>)["featureId"] as string;
      const sourceBinding = id === "instance-a" ? movingBinding : fixedBinding;
      return reply({ status: "ok", documentId: "doc-mates", revision: 7, sessionId,
        result: { faces: [
          { persistentId: `${id}:unsupported.0`, captureRevision: 7,
            sourceBinding: { type: "face", featureId: id, persistentFaceId: "surface.0", geometryKind: "sphere" } },
          { persistentId: `${id}:box.+Z`, captureRevision: 7, sourceBinding },
        ] } });
    }
    if (request["type"] === 47) {
      committed = true;
      return reply({ status: "ok", revision: 8, constraintId: request["constraintId"] });
    }
    throw new Error(`unexpected native type ${String(request["type"])}`);
  });
  let committed = false;
  Object.defineProperty(window, "kreoda", { configurable: true, value: {
    invoke,
    sessionSnapshot: vi.fn(async () => ({ sessionId, documentId: "doc-mates", revision: committed ? 8 : 7 })),
  } });
  return { client, invoke };
}

describe("CoreClient assembly mate capture", () => {
  beforeEach(() => {
    useDocumentUiStore.getState().resetDocument("doc-mates");
    useSelectionStore.getState().clear();
  });
  afterEach(() => { Reflect.deleteProperty(window, "kreoda"); });

  it("captures an exact public geometry DTO and sends command 47 through the registry with revision CAS", async () => {
    const { client, invoke } = seed();
    const movingContext = await client.captureAssemblyMateContext();
    const moving = await client.captureAssemblyGeometrySelection("instance-a", "instance-a:box.+Z", movingContext);
    useSelectionStore.setState({ selectedIds: ["instance-b:box.+Z"] });
    const fixedContext = await client.captureAssemblyMateContext();
    const fixed = await client.captureAssemblyGeometrySelection("instance-b", "instance-b:box.+Z", fixedContext);
    const applyContext = await client.captureAssemblyMateContext();
    await client.defineAssemblyConstraint({
      constraintId: "mate-parallel", kind: "parallel", movingId: "instance-a", fixedId: "instance-b",
      captureRevision: 7, movingPickId: moving.persistentId, fixedPickId: fixed.persistentId,
      movingSourceBinding: moving.sourceBinding, fixedSourceBinding: fixed.sourceBinding,
    }, applyContext);

    const requests = invoke.mock.calls.map(([encoded]) => decodeRequest(encoded as string));
    expect(requests[0]).toMatchObject({ type: CommandType.RequestSessionQuery, method: "findFaces",
      params: { featureId: "instance-a" }, expectedRevision: 7, expectedSessionId: sessionId });
    expect(requests[1]).toMatchObject({ type: CommandType.RequestSessionQuery, method: "findFaces",
      params: { featureId: "instance-b" }, expectedRevision: 7, expectedSessionId: sessionId });
    expect(requests[2]).toMatchObject({ type: CommandType.DefineAssemblyConstraint,
      kind: "parallel", movingPickId: "instance-a:box.+Z", fixedPickId: "instance-b:box.+Z",
      movingSourceBinding: movingBinding, fixedSourceBinding: fixedBinding,
      captureRevision: 7, expectedRevision: 7, expectedSessionId: sessionId });
    expect(requests[2]).not.toHaveProperty("method");
  });

  it("rejects a geometry response after the viewport selection changes", async () => {
    const { client, invoke } = seed();
    let release!: (value: string) => void;
    invoke.mockImplementationOnce(async () => new Promise<string>(resolve => { release = resolve; }));
    const context = await client.captureAssemblyMateContext();
    const pending = client.captureAssemblyGeometrySelection("instance-a", "instance-a:box.+Z", context);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    useSelectionStore.setState({ selectedIds: ["instance-a:box.-Z"] });
    release(reply({ status: "ok", documentId: "doc-mates", revision: 7, sessionId,
      result: { faces: [{ persistentId: "instance-a:box.+Z", captureRevision: 7, sourceBinding: movingBinding }] } }));
    await expect(pending).rejects.toThrow(/stale/i);
  });

  it("rejects a selected binding outside the instance dependency", async () => {
    const { client, invoke } = seed();
    invoke.mockImplementationOnce(async () => reply({ status: "ok", documentId: "doc-mates", revision: 7, sessionId,
      result: { faces: [{ persistentId: "instance-a:box.+Z", captureRevision: 7,
        sourceBinding: { ...movingBinding, featureId: "unrelated" } }] } }));
    const context = await client.captureAssemblyMateContext();
    await expect(client.captureAssemblyGeometrySelection("instance-a", "instance-a:box.+Z", context))
      .rejects.toThrow(/sorgente/i);
  });

  it("accepts one-revision UI advance while a committed command reply is pending", async () => {
    const { client, invoke } = seed();
    const context = await client.captureAssemblyMateContext();
    let release!: (value: string) => void;
    invoke.mockImplementationOnce(async () => new Promise<string>(resolve => { release = resolve; }));
    const pending = client.defineAssemblyConstraint({ constraintId: "mate-ground", kind: "ground", movingId: "instance-a" }, context);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    useDocumentUiStore.setState({ revision: 8 });
    vi.mocked(window.kreoda.sessionSnapshot).mockResolvedValue({ sessionId, documentId: "doc-mates", revision: 8,
      features: [], sketches: [], bodies: [] });
    release(reply({ status: "ok", revision: 8 }));
    await expect(pending).resolves.toEqual({ revision: 8 });
  });

  it("rejects a command reply after UI advances beyond its single committed revision", async () => {
    const { client, invoke } = seed();
    const context = await client.captureAssemblyMateContext();
    let release!: (value: string) => void;
    invoke.mockImplementationOnce(async () => new Promise<string>(resolve => { release = resolve; }));
    const pending = client.defineAssemblyConstraint({ constraintId: "mate-ground", kind: "ground", movingId: "instance-a" }, context);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    useDocumentUiStore.setState({ revision: 9 });
    release(reply({ status: "ok", revision: 8 }));
    await expect(pending).rejects.toThrow(/stale/i);
  });

  it("preserves legacy unscoped assembly commands", async () => {
    const { client, invoke } = seed();
    await client.defineAssemblyConstraint({ constraintId: "mate-ground", kind: "ground", movingId: "instance-a" });
    const request = decodeRequest(invoke.mock.calls[0][0] as string);
    expect(request).toMatchObject({ type: CommandType.DefineAssemblyConstraint, constraintId: "mate-ground", kind: "ground" });
    expect(request).not.toHaveProperty("expectedRevision");
    expect(request).not.toHaveProperty("expectedSessionId");
  });
});
