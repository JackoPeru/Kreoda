import { expect, it, vi } from "vitest";
import { runSessionQuery, type QueryEnv, type SelectionRegistry } from "../electron/session-queries";

type Reference = { id: string; ok: boolean; kind: string; owner?: string };

function fixture(options: {
  checks?: (ids: string[]) => Reference[];
  snapshots?: Array<{ documentId: string; revision: number }>;
  sessionIds?: string[];
} = {}) {
  const geometry = vi.fn(async (_documentId: string, _method: string, params: unknown) => {
    const ids = (params as { ids: string[] }).ids;
    const checks = options.checks?.(ids) ?? ids.map(id => ({ id, ok: true, kind: "sketch", owner: id }));
    return { valid: checks.every(check => check.ok), checks };
  });
  let snapshotIndex = 0;
  const snapshot = async () => {
    const configured = options.snapshots ?? [{ documentId: "doc", revision: 7 }];
    const value = configured[Math.min(snapshotIndex, configured.length - 1)]!;
    snapshotIndex++;
    return { ...value, features: [], sketches: [], bodies: [], tips: [] };
  };
  let sessionIndex = 0;
  const sessionId = () => {
    const configured = options.sessionIds ?? ["session"];
    const value = configured[Math.min(sessionIndex, configured.length - 1)]!;
    sessionIndex++;
    return value;
  };
  const env = { geometry, snapshot, sessionId, mesh: vi.fn(), faceInfo: vi.fn() } as unknown as QueryEnv;
  const selection: SelectionRegistry = { get: () => [], set: () => {}, clear: () => {}, drop: () => {} };
  const query = (selectionIds: string[], expectedRevision = 7) => runSessionQuery(
    env, selection, "client", "listCommands", { selectionIds, expectedRevision }, "doc");
  return { geometry, query };
}

function sweepCommand(reply: { result: unknown }) {
  const commands = (reply.result as { commands: {
    id: string; available: boolean; reason?: string; boundParameters: Record<string, unknown>;
  }[] }).commands;
  return commands.find(item => item.id === "CreateSurfaceSweep")!;
}

it("binds the selected sketches in order as profile then path", async () => {
  const f = fixture();
  const reply = await f.query(["profile-sketch", "path-sketch"]);
  expect(sweepCommand(reply)).toMatchObject({
    available: true,
    boundParameters: { profileSketchId: "profile-sketch", pathSketchId: "path-sketch" },
  });
  expect(f.geometry).toHaveBeenCalledWith("doc", "validateReferences", {
    ids: ["profile-sketch", "path-sketch"],
  });
});

it("preserves reversed selection order without role guessing", async () => {
  const f = fixture();
  expect(sweepCommand(await f.query(["path-first", "profile-second"]))).toMatchObject({
    available: true,
    boundParameters: { profileSketchId: "path-first", pathSketchId: "profile-second" },
  });
});

it("requires exactly two sketch references and binds nothing for other selections", async () => {
  const f = fixture({ checks: ids => ids.map((id, index) => ({
    id, ok: true, kind: id.startsWith("sketch") ? "sketch" : "body",
  })) });
  for (const ids of [["sketch-a"], ["sketch-a", "body-b"], ["sketch-a", "sketch-b", "sketch-c"]]) {
    expect(sweepCommand(await f.query(ids))).toMatchObject({
      available: false,
      reason: "Select exactly two sketches in profile then path order",
      boundParameters: {},
    });
  }
});

it("rejects stale revision and session lineage before exposing role bindings", async () => {
  const staleRevision = fixture();
  await expect(staleRevision.query(["profile", "path"], 6)).rejects.toMatchObject({ code: "NEED_FULL_SNAPSHOT" });
  expect(staleRevision.geometry).not.toHaveBeenCalled();

  const changedLineage = fixture({ sessionIds: ["session-a", "session-b"] });
  await expect(changedLineage.query(["profile", "path"])).rejects.toMatchObject({ code: "NEED_FULL_SNAPSHOT" });
  expect(changedLineage.geometry).not.toHaveBeenCalled();

  const changedDuringValidation = fixture({ sessionIds: ["session", "session", "new-session"] });
  await expect(changedDuringValidation.query(["profile", "path"])).rejects.toMatchObject({ code: "NEED_FULL_SNAPSHOT" });
  expect(changedDuringValidation.geometry).toHaveBeenCalledOnce();
});

it("rejects references whose validation crosses a document or revision fence", async () => {
  const f = fixture({ snapshots: [
    { documentId: "doc", revision: 7 },
    { documentId: "doc", revision: 8 },
  ] });
  await expect(f.query(["profile", "path"])).rejects.toMatchObject({ code: "NEED_FULL_SNAPSHOT" });

  const changedDocument = fixture({ snapshots: [
    { documentId: "doc", revision: 7 },
    { documentId: "another-doc", revision: 7 },
  ] });
  await expect(changedDocument.query(["profile", "path"])).rejects.toMatchObject({ code: "NEED_FULL_SNAPSHOT" });
});
