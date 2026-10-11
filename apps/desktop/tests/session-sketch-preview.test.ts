import { expect, it, vi } from "vitest";
import { runSessionQuery, type QueryEnv, type SelectionRegistry } from "../electron/session-queries";

it("checks sketch ownership and revision before a pure native solve and rejects a later epoch", async () => {
  let session = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const previewSketch = vi.fn(async () => { session = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";return { preview: true }; });
  const env = { sessionId: () => session, previewSketch,
    snapshot: async () => ({ documentId: "doc", revision: 7, features: [], sketches: [{ featureId: "sketch" }], bodies: [], tips: [] }) } as unknown as QueryEnv;
  const selections: SelectionRegistry = { get: () => [], set: () => {}, clear: () => {}, drop: () => {} };
  await expect(runSessionQuery(env, selections, "client", "previewSketch", { featureId: "missing", model: {}, expectedRevision: 7 }, "doc"))
    .rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(previewSketch).not.toHaveBeenCalled();
  await expect(runSessionQuery(env, selections, "client", "previewSketch", { featureId: "sketch", model: {}, expectedRevision: 7 }, "doc"))
    .rejects.toMatchObject({ code: "NEED_FULL_SNAPSHOT" });
});
