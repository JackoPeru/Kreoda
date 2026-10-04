import { expect, it, vi } from "vitest";
import type { SessionIncrementalDelta, SessionModelSnapshot } from "@kreoda/protocol";
import { createSessionUpdateQueue } from "../src/model/session-update-queue";

function snapshot(revision = 0, sessionId = "session-a"): SessionModelSnapshot {
  return { sessionId, documentId: "doc", revision, features: [{ featureId: "a", value: revision }], sketches: [], bodies: [] };
}
function delta(base: number, revision: number, sessionId = "session-a"): SessionIncrementalDelta {
  return { event: "delta", sessionId, documentId: "doc", originClientId: "remote", baseRevision: base, newRevision: revision, revision,
    added: [], updated: [{ kind: "feature", id: "a", index: 0, value: { featureId: "a", value: revision } }], removedIds: [], changedMeshIds: ["a"], referenceRemaps: [], warnings: [] };
}
function harness() {
  let context = { epoch: 1, documentId: "doc", revision: 0 };
  const fetchSnapshot = vi.fn(async () => snapshot());
  const commit = vi.fn(async (model: SessionModelSnapshot, _changed: string[] | null, _lineageChanged: boolean) => { context = { ...context, documentId: model.documentId, revision: model.revision }; });
  const onError = vi.fn();
  const queue = createSessionUpdateQueue({ context: () => context, fetchSnapshot, commit, onError });
  return { queue, fetchSnapshot, commit, onError, changeContext: (value: typeof context) => { context = value; } };
}

it("serializes recovery and later deltas; ordinary updates carry only changed mesh ids", async () => {
  const h = harness();
  await h.queue.refresh();
  let release!: () => void;
  const commit = h.commit.getMockImplementation()!;
  h.commit.mockImplementationOnce(async (...args) => { await new Promise<void>(resolve => { release = resolve; }); await commit(...args); });
  const first = h.queue.push(delta(0, 1));
  const second = h.queue.push(delta(1, 2));
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  expect(h.commit).toHaveBeenCalledTimes(2);
  release();
  await first;
  await second;
  expect(h.fetchSnapshot).toHaveBeenCalledTimes(1);
  expect(h.commit.mock.calls.at(-1)![0].revision).toBe(2);
  expect(h.commit.mock.calls[1]![1]).toEqual(["a"]);
  expect(h.onError).not.toHaveBeenCalled();
});

it("recovers a gap and a lower revision in a new session, but drops same-session duplicates", async () => {
  const h = harness();
  await h.queue.refresh();
  await h.queue.push(delta(0, 1));
  await h.queue.push(delta(0, 1));
  expect(h.commit).toHaveBeenCalledTimes(2);
  h.fetchSnapshot.mockResolvedValue(snapshot(4));
  await h.queue.push(delta(3, 4));
  expect(h.fetchSnapshot).toHaveBeenCalledTimes(2);
  expect(h.commit.mock.calls.at(-1)![1]).toBeNull();
  h.fetchSnapshot.mockResolvedValue(snapshot(1, "session-b"));
  await h.queue.push(delta(0, 1, "session-b"));
  expect(h.commit.mock.calls.at(-1)![0].sessionId).toBe("session-b");
  expect(h.commit.mock.calls.at(-1)![2]).toBe(true);
});

it("does not overwrite an opened document when an older snapshot reply arrives", async () => {
  const h = harness();
  let resolve!: (value: SessionModelSnapshot) => void;
  h.fetchSnapshot.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const pending = h.queue.refresh();
  await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
  h.changeContext({ epoch: 2, documentId: "opened", revision: 0 });
  resolve(snapshot(8));
  await pending;
  expect(h.commit).not.toHaveBeenCalled();
  expect(h.onError).not.toHaveBeenCalled();
});

it("retries recovery after a failed hydration and ignores pending work after disposal", async () => {
  const h = harness();
  h.commit.mockRejectedValueOnce(new Error("mesh failed"));
  await h.queue.refresh();
  expect(h.onError).toHaveBeenCalledTimes(1);
  h.fetchSnapshot.mockResolvedValue(snapshot(2));
  await h.queue.push(delta(1, 2));
  expect(h.fetchSnapshot).toHaveBeenCalledTimes(2);
  h.queue.dispose();
  await h.queue.push(delta(2, 3));
  expect(h.commit).toHaveBeenCalledTimes(2);
});

it("Open waits for authoritative hydration and surfaces a failed refresh without poisoning later work", async () => {
  const h = harness();
  h.commit.mockRejectedValueOnce(new Error("mesh failed"));
  await expect(h.queue.refreshAndVerify()).rejects.toThrow("did not synchronize");
  h.fetchSnapshot.mockResolvedValue(snapshot(2, "opened-session"));
  await h.queue.refreshAndVerify();
  await h.queue.push(delta(2, 3, "opened-session"));
  expect(h.commit.mock.calls.at(-1)![1]).toEqual(["a"]);
  expect(h.fetchSnapshot).toHaveBeenCalledTimes(2);
});

it("remembers session lineage when local revision drift invalidates the cached model before Open", async () => {
  const h = harness();
  await h.queue.refresh();
  h.changeContext({ epoch: 1, documentId: "doc", revision: 9 });
  h.fetchSnapshot.mockResolvedValue(snapshot(8));
  await expect(h.queue.refreshAndVerify()).rejects.toThrow("did not synchronize");
  h.fetchSnapshot.mockResolvedValue(snapshot(1, "opened-session"));
  await h.queue.refreshAndVerify();
  expect(h.commit.mock.calls.at(-1)![2]).toBe(true);
  expect(h.commit.mock.calls.at(-1)![0].revision).toBe(1);
});
