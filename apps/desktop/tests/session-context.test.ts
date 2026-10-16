import { expect, it, vi } from "vitest";
import { runSessionQuery, type QueryEnv, type SelectionRegistry } from "../electron/session-queries";
import { normalizeSnapshot } from "../electron/session-queries";

it("queries authoritative native datums and retains support frames in semantic context", async () => {
  const frame = { originMm: [10, 20, 30], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] };
  const datum = { featureId: "plane", kind: "DatumPlane", definition: { type: "principal", planeKind: "XY" }, dependsOn: [], resolved: frame, status: "ok" };
  const sketchFrame = { origin: frame.originMm, xAxis: frame.xAxis, yAxis: frame.yAxis, normal: frame.normal };
  const snapshot = normalizeSnapshot("doc", 7, [], [{ featureId: "sketch", planeKind: "Datum", plane: sketchFrame, supportRef: "plane", model: { points: [] } }], [datum]);
  expect(snapshot.datums).toEqual([datum]);expect(snapshot.sketches[0]).toMatchObject({ plane: sketchFrame, supportRef: "plane", model: { points: [] } });expect(snapshot.bodies).toEqual([]);
  const geometry = vi.fn(async () => datum);
  const env = { geometry, snapshot: async () => snapshot, mesh: vi.fn(), faceInfo: vi.fn() } as unknown as QueryEnv;
  const selection: SelectionRegistry = { get: () => [], set: () => {}, clear: () => {}, drop: () => {} };
  expect(await runSessionQuery(env, selection, "client", "getDatum", { featureId: "plane" }, "doc")).toEqual({ result: datum });
  expect(geometry).toHaveBeenCalledWith("doc", "getDatum", { featureId: "plane" });expect(env.mesh).not.toHaveBeenCalled();
});

function fixture() {
  let lineage = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const geometry = vi.fn(async () => ({ valid: true, checks: [{ id: "box:e1", ok: true, kind: "edge", confidence: 1, owner: "box", ownerBody: "body-box", role: "e1" }] }));
  const env = { geometry, snapshot: async () => ({ documentId: "doc", revision: 7, features: [], sketches: [], bodies: [], tips: [] }),
    sessionId: () => lineage, mesh: vi.fn(), faceInfo: vi.fn(), previewBegin: vi.fn(), previewUpdate: vi.fn(), previewCommit: vi.fn(), previewCancel: vi.fn() } as QueryEnv;
  const selection: SelectionRegistry = { get: () => [], set: () => {}, clear: () => {}, drop: () => {} };
  const query = (params: Record<string, unknown>) => runSessionQuery(env, selection, "client", "listCommands", params, "doc");
  return { geometry, query, reset: () => { lineage = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; } };
}

it("derives contextual fillet availability from validated native kinds and honest creation capability", async () => {
  const f = fixture();
  const reply = await f.query({ selectionIds: ["box:e1"], expectedRevision: 7 });
  expect((reply.result as { commands: { id: string }[] }).commands.find(c => c.id === "CreateFillet"))
    .toMatchObject({ available: true, supportsPreview: false, boundParameters: { targetId: "box", edgeIds: ["box:e1"] } });
  expect(f.geometry).toHaveBeenCalledWith("doc", "validateReferences", { ids: ["box:e1"] });
});

it("accepts an unambiguous indexed edge when the exact revision is fenced", async () => {
  const f = fixture();
  f.geometry.mockResolvedValueOnce({ valid: true, checks: [{ id: "box:e1", ok: true, kind: "edge", confidence: .5, owner: "box", ownerBody: "body-box", role: "e1" }] });
  const reply = await f.query({ selectionIds: ["box:e1"], expectedRevision: 7 });
  expect((reply.result as { commands: { id: string }[] }).commands.find(c => c.id === "CreateFillet")).toMatchObject({ available: true });
});

it("does not mutate shared registry availability when an owner binding is missing", async () => {
  const f = fixture();
  f.geometry.mockResolvedValueOnce({ valid: true, checks: [{ id: "box:e1", ok: true, kind: "edge", confidence: 1, owner: "", ownerBody: "", role: "e1" }] });
  await f.query({ selectionIds: ["box:e1"], expectedRevision: 7 });
  const reply = await f.query({});
  expect((reply.result as { commands: { id: string }[] }).commands.find(c => c.id === "CreateBox")).toMatchObject({ available: true });
});

it("reports actual invalid or ambiguous reference reasons instead of enabling selection commands", async () => {
  const f = fixture();
  f.geometry.mockResolvedValueOnce({ valid: false, checks: [{ id: "box:e1", ok: false, errorCode: "AMBIGUOUS_REFERENCE" }] } as never);
  const reply = await f.query({ selectionIds: ["box:e1"], expectedRevision: 7 });
  expect((reply.result as { commands: { id: string }[] }).commands.find(c => c.id === "CreateFillet"))
    .toMatchObject({ available: false, reason: expect.stringContaining("AMBIGUOUS_REFERENCE") });
});

it("rejects stale context before native validation", async () => {
  const f = fixture();
  await expect(f.query({ selectionIds: ["box:e1"], expectedRevision: 6 })).rejects.toMatchObject({ code: "NEED_FULL_SNAPSHOT" });
  expect(f.geometry).not.toHaveBeenCalled();
});

it("rejects a session reset during native validation even when revision is reused", async () => {
  const f = fixture();
  f.geometry.mockImplementationOnce(async () => { f.reset();return { valid: true, checks: [{ id: "box:e1", ok: true, kind: "edge", confidence: 1, owner: "box", ownerBody: "body-box", role: "e1" }] }; });
  await expect(f.query({ selectionIds: ["box:e1"], expectedRevision: 7 })).rejects.toMatchObject({ code: "NEED_FULL_SNAPSHOT" });
});

function sketchContext(reply: { result: unknown }) {
  const commands = (reply.result as { commands: { id: string; available: boolean; reason?: string; boundParameters: Record<string, unknown> }[] }).commands;
  return commands.find(command => command.id === "CreateSketch")!;
}

it("binds exactly one validated datum plane UUID to optional sketch support", async () => {
  const f = fixture();
  const planeId = "67e12d50-c1e9-4c42-9bf8-983de4eb9c21";
  f.geometry.mockResolvedValueOnce({ valid: true, checks: [{ id: planeId, ok: true, kind: "datumPlane", owner: planeId }] } as never);
  const reply = await f.query({ selectionIds: [planeId], expectedRevision: 7 });
  expect(sketchContext(reply)).toMatchObject({ available: true, boundParameters: { supportRef: planeId } });
});

it("keeps principal sketch creation unbound when no datum plane is selected", async () => {
  const f = fixture();
  const reply = await f.query({});
  expect(sketchContext(reply)).toMatchObject({ available: true, boundParameters: {} });
});

it.each(["datumAxis", "datumPoint"])("never binds %s as sketch support", async kind => {
  const f = fixture();
  const id = "67e12d50-c1e9-4c42-9bf8-983de4eb9c22";
  f.geometry.mockResolvedValueOnce({ valid: true, checks: [{ id, ok: true, kind, owner: id }] } as never);
  const reply = await f.query({ selectionIds: [id], expectedRevision: 7 });
  expect(sketchContext(reply)).toMatchObject({ available: true, boundParameters: {} });
});

it("marks multiple selected datum planes unavailable with an explicit ambiguity reason", async () => {
  const f = fixture();
  const first = "67e12d50-c1e9-4c42-9bf8-983de4eb9c23";
  const second = "67e12d50-c1e9-4c42-9bf8-983de4eb9c24";
  f.geometry.mockResolvedValueOnce({ valid: true, checks: [
    { id: first, ok: true, kind: "datumPlane", owner: first },
    { id: second, ok: true, kind: "datumPlane", owner: second },
  ] } as never);
  const reply = await f.query({ selectionIds: [first, second], expectedRevision: 7 });
  expect(sketchContext(reply)).toMatchObject({ available: false, reason: "AMBIGUOUS_REFERENCE", boundParameters: {} });
});

it("disables optional sketch support when an explicit native reference is invalid", async () => {
  const f = fixture();
  const brokenPlane = "67e12d50-c1e9-4c42-9bf8-983de4eb9c2a";
  f.geometry.mockResolvedValueOnce({ valid: false, checks: [
    { id: brokenPlane, ok: false, kind: "datumPlane", errorCode: "BROKEN_REFERENCE" },
  ] } as never);
  const reply = await f.query({ selectionIds: [brokenPlane], expectedRevision: 7 });
  expect(reply.result).toMatchObject({ contextValid: false });
  expect(sketchContext(reply)).toMatchObject({ available: false, reason: "BROKEN_REFERENCE", boundParameters: {} });
});
