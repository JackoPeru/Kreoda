import { expect, it, vi } from "vitest";
import { runSessionQuery, type QueryEnv, type SelectionRegistry } from "../electron/session-queries";

function fixture() {
  const geometry = vi.fn(async (_documentId: string, _method: string, params: unknown) => {
    const ids = (params as { ids: string[] }).ids;
    return {
      valid: true,
      checks: ids.map(id => ({
        id, ok: true, kind: "face", confidence: 1,
        owner: id.split(":")[0], role: "face.planar.+Z",
      })),
    };
  });
  const snapshot = async () => ({ documentId: "doc", revision: 7, features: [], sketches: [], bodies: [], tips: [] });
  const env = { geometry, snapshot, sessionId: () => "session", mesh: vi.fn(), faceInfo: vi.fn() } as unknown as QueryEnv;
  const selection: SelectionRegistry = { get: () => [], set: () => {}, clear: () => {}, drop: () => {} };
  const query = (selectionIds: string[]) => runSessionQuery(env, selection, "client", "listCommands",
    { selectionIds, expectedRevision: 7 }, "doc");
  return { geometry, query };
}

function command(reply: { result: unknown }, id: string) {
  const commands = (reply.result as { commands: { id: string; available: boolean; reason?: string; boundParameters: Record<string, unknown> }[] }).commands;
  return commands.find(item => item.id === id)!;
}

it("binds ordered distinct sewing owners from revision-fenced selected references", async () => {
  const f = fixture();
  const reply = await f.query(["surface-b:face.1", "surface-a:face.1", "surface-b:face.2"]);
  expect(command(reply, "CreateSurfaceSew")).toMatchObject({
    available: true,
    boundParameters: { featureIds: ["surface-b", "surface-a"] },
  });
  expect(f.geometry).toHaveBeenCalledWith("doc", "validateReferences", {
    ids: ["surface-b:face.1", "surface-a:face.1", "surface-b:face.2"],
  });
});

it("binds whole-feature selections returned with the canonical body kind", async () => {
  const f = fixture();
  f.geometry.mockResolvedValueOnce({ valid: true, checks: [
    { id: "surface-b", ok: true, kind: "body", owner: "surface-b", ownerBody: "body-surface-b" },
    { id: "surface-a", ok: true, kind: "body", owner: "surface-a", ownerBody: "body-surface-a" },
  ] } as never);
  const reply = await f.query(["surface-b", "surface-a"]);
  expect(command(reply, "CreateSurfaceSew")).toMatchObject({
    available: true,
    boundParameters: { featureIds: ["surface-b", "surface-a"] },
  });
});

it("binds one selected owner to SurfaceOffset and fails closed when any owner is missing", async () => {
  const f = fixture();
  expect(command(await f.query(["surface-a:face.1"]), "CreateSurfaceOffset")).toMatchObject({
    available: true, boundParameters: { targetId: "surface-a" },
  });

  f.geometry.mockResolvedValueOnce({ valid: true, checks: [
    { id: "surface-a:face.1", ok: true, kind: "face", owner: "surface-a" },
    { id: "surface-b:face.1", ok: true, kind: "face", owner: "" },
  ] } as never);
  const reply = await runSessionQuery(
    { ...f, snapshot: async () => ({ documentId: "doc", revision: 7, features: [], sketches: [], bodies: [], tips: [] }),
      sessionId: () => "session" } as unknown as QueryEnv,
    { get: () => [], set: () => {}, clear: () => {}, drop: () => {} }, "client", "listCommands",
    { selectionIds: ["surface-a:face.1", "surface-b:face.1"], expectedRevision: 7 }, "doc");
  expect(command(reply, "CreateSurfaceSew")).toMatchObject({
    available: false, reason: "Selection must resolve to feature owners", boundParameters: {},
  });
});
