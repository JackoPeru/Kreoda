import { expect, it, vi } from "vitest";
import { runSessionQuery, type QueryEnv, type SelectionRegistry } from "../electron/session-queries";

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
