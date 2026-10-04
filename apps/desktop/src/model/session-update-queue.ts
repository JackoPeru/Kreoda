import { applySessionModelDelta, type SessionModelSnapshot } from "@kreoda/protocol";

export interface SessionViewContext {
  epoch: number;
  documentId: string;
  revision: number;
}

/** One ordered chain owns patches and snapshot recovery, including mesh hydration. */
export function createSessionUpdateQueue(hooks: {
  context: () => SessionViewContext;
  fetchSnapshot: () => Promise<SessionModelSnapshot>;
  commit: (model: SessionModelSnapshot, changedMeshIds: string[] | null, lineageChanged: boolean) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  let chain = Promise.resolve();
  let model: SessionModelSnapshot | null = null;
  // Local legacy view updates can invalidate the cached projection without
  // replacing the native session. Retain lineage independently of that cache.
  let sessionId: string | null = null;
  let epoch: number | null = null;
  let disposed = false;

  function sameContext(before: SessionViewContext): boolean {
    const current = hooks.context();
    return current.epoch === before.epoch && current.documentId === before.documentId && current.revision === before.revision;
  }

  async function recover(): Promise<void> {
    const before = hooks.context();
    const snapshot = await hooks.fetchSnapshot();
    if (disposed || !sameContext(before)) { model = null; return; }
    const lineageChanged = snapshot.documentId !== before.documentId ||
      (sessionId !== null && sessionId !== snapshot.sessionId);
    if (!lineageChanged && snapshot.revision < before.revision) { model = null; return; }
    await hooks.commit(snapshot, null, lineageChanged);
    if (disposed) return;
    sessionId = snapshot.sessionId;
    const current = hooks.context();
    model = current.documentId === snapshot.documentId && current.revision === snapshot.revision ? snapshot : null;
    epoch = current.epoch;
  }

  function enqueue(work: () => Promise<void>): Promise<void> {
    chain = chain.then(async () => {
      if (disposed) return;
      try { await work(); }
      catch (error) { model = null; hooks.onError(error); }
    });
    return chain;
  }

  return {
    refresh: () => enqueue(recover),
    refreshAndVerify: async () => {
      await enqueue(recover);
      const current = hooks.context();
      if (!model || epoch !== current.epoch || model.documentId !== current.documentId || model.revision !== current.revision) {
        throw new Error("Session view did not synchronize");
      }
    },
    push: (delta: unknown) => enqueue(async () => {
      const current = hooks.context();
      if (!model || epoch !== current.epoch || model.documentId !== current.documentId || model.revision !== current.revision) {
        await recover();
        return;
      }
      const decision = applySessionModelDelta(model, delta);
      if (decision.status === "needs-snapshot") { await recover(); return; }
      if (decision.status === "duplicate") return;
      const changed = (delta as { changedMeshIds: string[] }).changedMeshIds;
      await hooks.commit(decision.model, changed, false);
      const after = hooks.context();
      model = after.epoch === current.epoch && after.documentId === decision.model.documentId && after.revision === decision.model.revision ? decision.model : null;
    }),
    dispose: () => { disposed = true; model = null; },
  };
}
