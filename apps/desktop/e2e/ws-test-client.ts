// Shared JSON-over-WebSocket session test client (E2E + vitest).
// Mirrors the Quest/agent wire shape: requestId correlation, errorCode
// routing, server events, close-fails-pending (never hang forever).
import WebSocket from "ws";

/** Minimal JSON session client (the Quest/agent shape, over WebSocket). */
export class SessionClient {
  private ws: WebSocket | null = null;
  private seq = 0;
  private pending = new Map<
    string,
    { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }
  >();
  readonly events: Record<string, unknown>[] = [];

  async connect(token: string, port: number): Promise<Record<string, unknown>> {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      this.ws!.once("open", () => resolve());
      this.ws!.once("error", (e) => reject(e));
    });
    // A server-side close (bad token, hello timeout, relay stop) carries no
    // reply: fail every pending call loudly instead of hanging forever.
    this.ws.on("close", () => {
      for (const [, p] of this.pending) {
        p.reject(new Error("socket closed before reply"));
      }
      this.pending.clear();
    });
    this.ws.on("message", (data) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (typeof msg["requestId"] === "string") {
        const p = this.pending.get(msg["requestId"] as string);
        if (!p) return;
        this.pending.delete(msg["requestId"] as string);
        if (msg["ok"] === true) p.resolve(msg);
        else {
          const err = new Error(
            (msg["error"] as string | undefined) ?? "session call failed",
          ) as Error & { code?: string };
          err.code = msg["errorCode"] as string | undefined;
          p.reject(err);
        }
        return;
      }
      this.events.push(msg);
    });
    return this.call("hello", {
      clientType: "test",
      clientName: "phase11-acceptance",
      protocolVersion: 1,
      token,
    });
  }

  call(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("not connected"));
    }
    const requestId = `t-${++this.seq}`;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.ws!.send(JSON.stringify({ requestId, method, params }));
    });
  }

  // Relay deltas carry core `featureId` keys (renderer snapshots use `id`).
  deltas(): { revision: number; features: { featureId: string }[] }[] {
    return this.events.filter((e) => e["event"] === "delta") as {
      revision: number;
      features: { featureId: string }[];
    }[];
  }

  async waitDelta(
    revision: number,
    timeoutMs = 30000,
  ): Promise<{ revision: number; features: { featureId: string }[] }> {
    const t0 = Date.now();
    for (;;) {
      const hit = this.deltas().find((d) => d.revision === revision);
      if (hit) return hit;
      if (Date.now() - t0 > timeoutMs) {
        throw new Error(`no delta at revision ${revision} within timeout`);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  closed(): Promise<void> {
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.ws!.once("close", () => resolve());
      this.ws!.close();
    });
  }

  closeRaw(): void {
    try {
      this.ws?.close();
    } catch {
      // Best-effort.
    }
  }
}
