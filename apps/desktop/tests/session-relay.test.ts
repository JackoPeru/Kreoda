// Phase 11b relay logic, in-process (no Electron): hello pairing, snapshot,
// serialized mutations with feature locks, idempotent retries, revision
// fencing, delta broadcast. The sidecar is stubbed at the framed-bytes
// boundary with canned core JSON responses.

import { describe, expect, it } from "vitest";
import { createServer } from "node:net";
import { WebSocket } from "ws";
import { SessionRelay } from "../electron/session";
import {
  QUERY_METHODS,
} from "../electron/session-queries";
import {
  QUERY_METHODS_CONTRACT,
  REQUIRED_PARAMS,
  SESSION_CONTROL_METHODS,
} from "@kreoda/protocol";
import type { SidecarManager } from "../electron/sidecar";
import { SessionClient } from "../e2e/ws-test-client";

const TOKEN = "unit-token";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("could not allocate a loopback port");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

interface StoredFeature {
  featureId: string;
  type: string;
  paramsMm: number[];
  volumeMm3: number;
  dependsOn: string[];
  refExtra: string;
  expressions: Record<string, string>;
}

/** Canned core: boxes + snapshot + undo, with a revision counter. */
function fakeSidecar(options: {
  beforeInvoke?: (type: number) => void | Promise<void>;
} = {}) {
  const features = new Map<string, StoredFeature>();
  let revision = 0;
  // Minimal transaction fence mirror (the real one lives in the dispatcher):
  // mutating calls outside the open unit are rejected as TRANSACTION_OPEN.
  let openTxn: string | null = null;
  // Keys present at begin: rollback drops everything added inside the unit.
  let txnBaseline: Set<string> | null = null;
  const calls: number[] = [];
  const b64 = (a: Float32Array | Uint32Array): string =>
    Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString("base64");
  // Two-quad box mesh (top +Z / bottom -Z) for the given owner id.
  const meshBytes = (
    requestId: string,
    owner: string,
    w: number,
    h: number,
    z: number,
  ): Uint8Array => {
    const positions = new Float32Array([
      0, 0, z, w, 0, z, w, h, z, 0, h, z,
      0, 0, 0, w, 0, 0, w, h, 0, 0, h, 0,
    ]);
    const normals = new Float32Array([
      0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
      0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
    ]);
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
    return new TextEncoder().encode(
      JSON.stringify({
        protocolVersion: 1,
        requestId,
        status: "ok",
        volumeMm3: w * h * z,
        bboxMm: [0, 0, 0, w, h, z],
        triangleCount: 4,
        vertexCount: 8,
        positionsB64: b64(positions),
        normalsB64: b64(normals),
        indicesB64: b64(indices),
        edgeVerticesB64: "",
        faces: [
          { persistentFaceId: `${owner}:box.+Z`, triangleStart: 0, triangleCount: 2 },
          { persistentFaceId: `${owner}:box.-Z`, triangleStart: 2, triangleCount: 2 },
        ],
        edges: [],
        revision,
      }),
    );
  };
  const invoke = async (frame: Uint8Array): Promise<Uint8Array> => {
    const envelope = JSON.parse(
      new TextDecoder().decode(frame.slice(4)),
    ) as {
      requestId: string;
      documentId: string;
      type: number;
    featureId?: string;
      faceRole?: string;
      widthMm?: number;
      heightMm?: number;
      depthMm?: number;
      isPreview?: boolean;
      transactionId?: string;
    };
    calls.push(envelope.type);
    await options.beforeInvoke?.(envelope.type);
    const fenced = (): Record<string, unknown> | null => {
      // Joined steps (27-29 control excluded) must carry the open unit id.
      if (
        openTxn &&
        envelope.type !== 27 &&
        envelope.type !== 28 &&
        envelope.type !== 29 &&
        envelope.transactionId !== openTxn
      ) {
        return {
          status: "error",
          errorCode: "TRANSACTION_OPEN",
          errorMessage: "a session transaction is in progress",
        };
      }
      return null;
    };
    const respond = (body: Record<string, unknown>): Uint8Array => {
      const bytes = new TextEncoder().encode(
        JSON.stringify({
          protocolVersion: 1,
          requestId: envelope.requestId,
          ...body,
        }),
      );
      // Like the real SidecarManager (FrameDecoder strips the u32 prefix),
      // resolve with the payload only — not the framed envelope.
      return bytes;
    };
    if (envelope.type === 26) {
      return respond({
        status: "ok",
        features: [...features.values()],
        sketches: [],
        revision,
      });
    }
    if (envelope.type === 12) {
      const rec = envelope.featureId ? features.get(envelope.featureId) : undefined;
      if (!rec) {
        return respond({
          status: "error",
          errorCode: "NOT_FOUND",
          errorMessage: "no mesh",
        });
      }
      const [w, h, d] = [rec.paramsMm[0] ?? 10, rec.paramsMm[1] ?? 10, rec.paramsMm[2] ?? 10];
      return meshBytes(envelope.requestId, rec.featureId, w, h, d);
    }
    if (envelope.type === 23) {
      const rec = envelope.featureId ? features.get(envelope.featureId) : undefined;
      if (!rec) {
        return respond({
          status: "error",
          errorCode: "NOT_FOUND",
          errorMessage: "no such feature",
        });
      }
      const d = rec.paramsMm[2] ?? 10;
      return respond({
        status: "ok",
        originMm: [0, 0, d],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        normal: [0, 0, 1],
      });
    }
    if (envelope.type === 6 && envelope.isPreview) {
      const rec = envelope.featureId ? features.get(envelope.featureId) : undefined;
      if (!rec) {
        return respond({
          status: "error",
          errorCode: "PREVIEW_FAILED",
          errorMessage: "unknown feature",
        });
      }
      const [w, h, d] = [rec.paramsMm[0] ?? 10, rec.paramsMm[1] ?? 10, rec.paramsMm[2] ?? 10];
      return meshBytes(envelope.requestId, rec.featureId, w, h, d);
    }
    if (envelope.type === 3) {
      const fence = fenced();
      if (fence) return respond(fence);
      revision += 1;
      const rec: StoredFeature = {
        featureId: envelope.featureId ?? "box-x",
        type: "Box",
        paramsMm: [envelope.widthMm ?? 0, envelope.heightMm ?? 0, envelope.depthMm ?? 0],
        volumeMm3: 1,
        dependsOn: [],
        refExtra: "",
        expressions: {},
      };
      features.set(rec.featureId, rec);
      return respond({ status: "ok", ...rec, revision });
    }
    if (envelope.type === 6) {
      const fence = fenced();
      if (fence) return respond(fence);
      revision += 1;
      return respond({
        status: "ok",
        featureId: envelope.featureId ?? "",
        revision,
        features: [...features.values()],
        sketches: [],
      });
    }
    if (envelope.type === 27) {
      openTxn = envelope.transactionId ?? null;
      txnBaseline = new Set(features.keys());
      return respond({
        status: "ok",
        transactionId: (envelope as { transactionId?: string }).transactionId ?? "",
        features: [...features.values()],
        sketches: [],
        revision,
      });
    }
    if (envelope.type === 28) {
      if (!openTxn) {
        return respond({
          status: "error",
          errorCode: "NO_TRANSACTION",
          errorMessage: "no open transaction",
        });
      }
      if (envelope.transactionId !== openTxn) {
        return respond({
          status: "error",
          errorCode: "NOT_OWNER",
          errorMessage: "not the transaction owner",
        });
      }
      openTxn = null;
      txnBaseline = null;
      revision += 1;
      return respond({
        status: "ok",
        transactionId: (envelope as { transactionId?: string }).transactionId ?? "",
        features: [...features.values()],
        sketches: [],
        revision,
      });
    }
    if (envelope.type === 29) {
      if (!openTxn) {
        return respond({
          status: "error",
          errorCode: "NO_TRANSACTION",
          errorMessage: "no open transaction",
        });
      }
      if (envelope.transactionId !== openTxn) {
        return respond({
          status: "error",
          errorCode: "NOT_OWNER",
          errorMessage: "not the transaction owner",
        });
      }
      if (txnBaseline) {
        for (const k of [...features.keys()]) {
          if (!txnBaseline.has(k)) features.delete(k);
        }
        txnBaseline = null;
      }
      openTxn = null;
      return respond({
        status: "ok",
        transactionId: (envelope as { transactionId?: string }).transactionId ?? "",
        features: [...features.values()],
        sketches: [],
        revision,
      });
    }
    if (envelope.type === 8) {
      const fence = fenced();
      if (fence) return respond(fence);
      revision += 1;
      const last = [...features.keys()].pop();
      if (last) features.delete(last);
      return respond({
        status: "ok",
        features: [...features.values()],
        sketches: [],
        revision,
      });
    }
    return respond({
      status: "error",
      errorCode: "UNKNOWN_COMMAND",
      errorMessage: "unsupported type",
    });
  };
  return {
    manager: { invoke } as unknown as SidecarManager,
    calls,
    features: () => [...features.values()],
  };
}

describe("SessionRelay", () => {
  it("rejects repeat hello and rolls back the real transaction on owner disconnect", async () => {
    const fake = fakeSidecar();
    const port = await freePort();
    const relay = new SessionRelay(() => fake.manager);
    relay.start({ port, host: "127.0.0.1", token: TOKEN });
    const owner = new SessionClient();
    const observer = new SessionClient();
    try {
      await owner.connect(TOKEN, port);
      await observer.connect(TOKEN, port);
      await owner.call("txnBegin", { transactionId: "owned-txn" });
      await owner.call("invoke", {
        documentId: "doc-phase1",
        type: 3,
        transactionId: "owned-txn",
        fields: { featureId: "owned-box-a", widthMm: 1, heightMm: 1, depthMm: 1 },
      });

      let repeatedHello: { ok: boolean; errorCode?: string } = { ok: true };
      try {
        await owner.call("hello", {
          clientType: "test",
          clientName: "repeat-hello",
          protocolVersion: 1,
          token: TOKEN,
        });
      } catch (e) {
        repeatedHello = {
          ok: false,
          errorCode: (e as Error & { code?: string }).code,
        };
      }
      const clientCountAfterRepeat = relay.clientCount;
      const joined = await owner.call("invoke", {
        documentId: "doc-phase1",
        type: 3,
        transactionId: "owned-txn",
        fields: { featureId: "owned-box-b", widthMm: 2, heightMm: 2, depthMm: 2 },
      });

      await owner.closed();
      const deadline = Date.now() + 500;
      while (!fake.calls.includes(29) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const status = await observer.call("txnStatus", {});

      expect(repeatedHello).toEqual({ ok: false, errorCode: "BAD_HELLO" });
      expect(clientCountAfterRepeat).toBe(2);
      expect(joined["featureId"]).toBe("owned-box-b");
      expect(fake.calls.filter((type) => type === 29)).toHaveLength(1);
      expect(fake.features()).toHaveLength(0);
      expect(status["open"]).toBe(false);
      expect(status["ownerConnected"]).toBeUndefined();
      expect(relay.clientCount).toBe(1);
    } finally {
      await owner.closed();
      observer.closeRaw();
      relay.stop();
    }
  });

  it("rolls back when the owner disconnects while txnBegin is in flight", async () => {
    let beginStarted!: () => void;
    let releaseBegin!: () => void;
    const started = new Promise<void>((resolve) => {
      beginStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseBegin = resolve;
    });
    const fake = fakeSidecar({
      beforeInvoke: async (type) => {
        if (type === 27) {
          beginStarted();
          await gate;
        }
      },
    });
    const port = await freePort();
    const relay = new SessionRelay(() => fake.manager);
    relay.start({ port, host: "127.0.0.1", token: TOKEN });
    const owner = new SessionClient();
    const observer = new SessionClient();
    try {
      await owner.connect(TOKEN, port);
      await observer.connect(TOKEN, port);
      const pendingBegin = owner
        .call("txnBegin", { transactionId: "slow-begin" })
        .then(
          () => null,
          (error: unknown) => error,
        );
      await started;

      await owner.closed();
      const disconnectDeadline = Date.now() + 500;
      while (relay.clientCount !== 1 && Date.now() < disconnectDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      releaseBegin();
      await pendingBegin;

      const rollbackDeadline = Date.now() + 500;
      while (!fake.calls.includes(29) && Date.now() < rollbackDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const status = await observer.call("txnStatus", {});

      expect(relay.clientCount).toBe(1);
      expect(fake.calls.filter((type) => type === 27)).toHaveLength(1);
      expect(fake.calls.filter((type) => type === 29)).toHaveLength(1);
      expect(status["open"]).toBe(false);
      expect(fake.features()).toHaveLength(0);
    } finally {
      releaseBegin();
      await owner.closed();
      observer.closeRaw();
      relay.stop();
    }
  });

  it("validates invoke fields and blocks native transaction commands", async () => {
    const fake = fakeSidecar();
    const port = await freePort();
    const relay = new SessionRelay(() => fake.manager);
    relay.start({ port, host: "127.0.0.1", token: TOKEN });
    const client = new SessionClient();
    try {
      await client.connect(TOKEN, port);
      const before = fake.calls.length;

      for (const fields of [null, [], "scalar", 7]) {
        await expect(client.call("invoke", {
          documentId: "doc-phase1",
          type: 3,
          fields,
        })).rejects.toMatchObject({ code: "BAD_PARAMS" });
      }
      for (const key of [
        "protocolVersion",
        "requestId",
        "documentId",
        "type",
        "transactionId",
      ]) {
        await expect(client.call("invoke", {
          documentId: "doc-phase1",
          type: 3,
          fields: { [key]: "attacker-value" },
        })).rejects.toMatchObject({ code: "BAD_PARAMS" });
      }
      for (const type of [27, 28, 29]) {
        await expect(client.call("invoke", {
          documentId: "doc-phase1",
          type,
          transactionId: "forged-txn",
          fields: { transactionId: "forged-txn" },
        })).rejects.toMatchObject({ code: "BAD_PARAMS" });
      }
      expect(fake.calls).toHaveLength(before);

      const valid = await client.call("invoke", {
        documentId: "doc-phase1",
        type: 3,
      });
      expect(valid["featureId"]).toBe("box-x");
      expect(fake.features()).toHaveLength(1);
    } finally {
      client.closeRaw();
      relay.stop();
    }
  });

  it("fences foreign transaction controls and mutations before native dispatch", async () => {
    const fake = fakeSidecar();
    const port = await freePort();
    const relay = new SessionRelay(() => fake.manager);
    relay.start({ port, host: "127.0.0.1", token: TOKEN });
    const owner = new SessionClient();
    const other = new SessionClient();
    try {
      await owner.connect(TOKEN, port);
      await other.connect(TOKEN, port);
      await owner.call("txnBegin", { transactionId: "owned-txn" });
      const before = fake.calls.length;

      await expect(other.call("invoke", {
        documentId: "doc-phase1",
        type: 3,
        fields: { featureId: "outsider-box", widthMm: 1, heightMm: 1, depthMm: 1 },
      })).rejects.toMatchObject({ code: "BUSY" });
      await expect(other.call("invoke", {
        documentId: "doc-phase1",
        type: 3,
        transactionId: "owned-txn",
        fields: { featureId: "outsider-box-joined", widthMm: 1, heightMm: 1, depthMm: 1 },
      })).rejects.toMatchObject({ code: "BUSY" });
      await expect(other.call("txnCommit", { transactionId: "owned-txn" }))
        .rejects.toMatchObject({ code: "NOT_OWNER" });
      await expect(other.call("txnRollback", { transactionId: "owned-txn" }))
        .rejects.toMatchObject({ code: "NOT_OWNER" });
      await expect(other.call("txnCommit", { transactionId: "other-txn" }))
        .rejects.toMatchObject({ code: "NO_TRANSACTION" });
      await expect(other.call("txnRollback", { transactionId: "other-txn" }))
        .rejects.toMatchObject({ code: "NO_TRANSACTION" });
      await expect(other.call("txnCommit", {}))
        .rejects.toMatchObject({ code: "BAD_PARAMS" });
      await expect(other.call("txnRollback", {}))
        .rejects.toMatchObject({ code: "BAD_PARAMS" });
      await expect(other.call("txnForceRollback", { transactionId: "owned-txn" }))
        .rejects.toMatchObject({ code: "TRANSACTION_BUSY" });
      expect(fake.calls).toHaveLength(before);
      const status = await other.call("txnStatus", {});
      expect(status["open"]).toBe(true);
      expect(status["ownerConnected"]).toBe(true);

      const joined = await owner.call("invoke", {
        documentId: "doc-phase1",
        type: 3,
        transactionId: "owned-txn",
        fields: { featureId: "owner-box", widthMm: 3, heightMm: 3, depthMm: 3 },
      });
      expect(joined["featureId"]).toBe("owner-box");
      await owner.call("txnCommit", { transactionId: "owned-txn" });
      expect(fake.calls.filter((type) => type === 3)).toHaveLength(1);
      expect(fake.calls.filter((type) => type === 28)).toHaveLength(1);
      expect(fake.calls.filter((type) => type === 29)).toHaveLength(0);
      expect(fake.features().map((feature) => feature.featureId)).toEqual(["owner-box"]);
    } finally {
      owner.closeRaw();
      other.closeRaw();
      relay.stop();
    }
  });

  it("rejects malformed frames before core dispatch and keeps valid frames working", async () => {
    const fake = fakeSidecar();
    const port = await freePort();
    const relay = new SessionRelay(() => fake.manager);
    relay.start({ port, host: "127.0.0.1", token: TOKEN });

    const connect = async (): Promise<WebSocket> => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });
      return ws;
    };
    const nextMessage = (ws: WebSocket): Promise<Record<string, unknown>> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("reply timeout")), 1000);
        ws.once("message", (data) => {
          clearTimeout(timer);
          try {
            resolve(JSON.parse(String(data)) as Record<string, unknown>);
          } catch (e) {
            reject(e);
          }
        });
      });
    const authenticate = async (ws: WebSocket): Promise<void> => {
      const reply = nextMessage(ws);
      ws.send(JSON.stringify({
        requestId: "hello",
        method: "hello",
        params: { protocolVersion: 1, token: TOKEN },
      }));
      expect((await reply)["ok"]).toBe(true);
    };
    const expectMalformedClose = async (frame: string): Promise<void> => {
      const ws = await connect();
      try {
        await authenticate(ws);
        const type3Calls = fake.calls.filter((type) => type === 3).length;
        const closed = new Promise<number>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("socket did not close")), 1000);
          ws.once("close", (code) => {
            clearTimeout(timer);
            resolve(code);
          });
        });
        ws.send(frame);
        await expect(closed).resolves.toBe(4400);
        expect(fake.calls.filter((type) => type === 3)).toHaveLength(type3Calls);
      } finally {
        ws.close();
      }
    };

    try {
      const mutation = {
        method: "invoke",
        params: {
          documentId: "doc-phase1",
          type: 3,
          fields: { featureId: "malformed-box", widthMm: 10, heightMm: 10, depthMm: 10 },
        },
      };
      for (const requestId of [undefined, "", "   ", null, 7]) {
        await expectMalformedClose(JSON.stringify({ ...mutation, requestId }));
      }
      for (const frame of ["{malformed", "null", "[]", "42", '"frame"']) {
        await expectMalformedClose(frame);
      }

      const ws = await connect();
      try {
        await authenticate(ws);
        const callsBeforeBadParams = fake.calls.length;
        for (const [index, params] of [null, [], "text", 7].entries()) {
          const reply = nextMessage(ws);
          const requestId = `bad-params-${index}`;
          ws.send(JSON.stringify({ requestId, method: "snapshot", params }));
          await expect(reply).resolves.toMatchObject({
            requestId,
            ok: false,
            errorCode: "BAD_PARAMS",
          });
        }
        expect(fake.calls).toHaveLength(callsBeforeBadParams);
        expect(fake.calls.filter((type) => type === 3)).toHaveLength(0);

        const validReply = nextMessage(ws);
        ws.send(JSON.stringify({
          requestId: "valid-command",
          method: "invoke",
          params: {
            documentId: "doc-phase1",
            type: 3,
            fields: { featureId: "valid-box", widthMm: 10, heightMm: 10, depthMm: 10 },
          },
        }));
        await expect(validReply).resolves.toMatchObject({
          requestId: "valid-command",
          ok: true,
          featureId: "valid-box",
        });
        expect(fake.calls.filter((type) => type === 3)).toHaveLength(1);
      } finally {
        ws.close();
      }
    } finally {
      relay.stop();
    }
  });

  it("hello pairing, snapshot, invoke, undo broadcast, rejects", async () => {
    const fake = fakeSidecar();
    const deltas: unknown[] = [];
    const relay = new SessionRelay(() => fake.manager, (d) => {
      deltas.push(d);
    });
    const port = await freePort();
    relay.start({ port, host: "127.0.0.1", token: TOKEN });
    const client = new SessionClient();
    try {
      const hello = await client.connect(TOKEN, port);
      expect(typeof hello["clientId"]).toBe("string");
      expect(hello["revision"]).toBe(0);

      const empty = (await client.call("snapshot", {})) as {
        features: unknown[];
      };
      expect(empty.features).toHaveLength(0);

      const created = await client.call("invoke", {
        documentId: "doc-phase1",
        type: 3,
        fields: { featureId: "box-a", widthMm: 10, heightMm: 10, depthMm: 10 },
      });
      expect(created["featureId"]).toBe("box-a");
      expect(deltas).toHaveLength(1);

      const undone = await client.call("invoke", {
        documentId: "doc-phase1",
        type: 8,
        fields: {},
      });
      expect(
        ((undone["features"] as unknown[]) ?? []).length,
      ).toBe(0);
      expect(deltas).toHaveLength(2);

      await expect(
        client.call("invoke", {
          documentId: "doc-phase1",
          type: 3,
          baseRevision: 999,
          fields: { featureId: "box-b", widthMm: 1, heightMm: 1, depthMm: 1 },
        }),
      ).rejects.toMatchObject({ code: "NEED_FULL_SNAPSHOT" });
      await expect(client.call("nope", {})).rejects.toMatchObject({
        code: "NOT_IMPLEMENTED",
      });
      expect(fake.features()).toHaveLength(0);
    } finally {
      client.closeRaw();
      relay.stop();
    }
  });

  it("rejects bad pairing tokens", async () => {    const fake = fakeSidecar();
    const relay = new SessionRelay(() => fake.manager);
    const port = await freePort();
    relay.start({ port, host: "127.0.0.1", token: TOKEN });
    const raw = new WebSocket(`ws://127.0.0.1:${port}`);
    try {
      await new Promise<void>((resolve, reject) => {
        raw.once("open", () => resolve());
        raw.once("error", (e) => reject(e));
      });
      const closed = new Promise<void>((resolve) => {
        raw.once("close", () => resolve());
      });
      raw.send(
        JSON.stringify({
          requestId: "evil-1",
          method: "hello",
          params: { protocolVersion: 1, token: "wrong" },
        }),
      );
      await closed;
    } finally {
      try {
        raw.close();
      } catch {
        // Best-effort.
      }
      relay.stop();
    }
  });
});

describe("SessionQueries (§11.7–§11.9, §11.11, §11.15)", () => {
  async function bootBox(): Promise<{
    relay: SessionRelay;
    client: SessionClient;
    boxId: string;
  }> {
    const fake = fakeSidecar();
    const relay = new SessionRelay(() => fake.manager);
    const port = await freePort();
    relay.start({ port, host: "127.0.0.1", token: TOKEN });
    const client = new SessionClient();
    await client.connect(TOKEN, port);
    await client.call("invoke", {
      documentId: "doc-phase1",
      type: 3,
      fields: { featureId: "box-q", widthMm: 10, heightMm: 10, depthMm: 10 },
    });
    return { relay, client, boxId: "box-q" };
  }

  it("introspection, selection, find, manipulators, measures, validate", async () => {
    const { relay, client, boxId } = await bootBox();
    try {
      const q = async (method: string, params: Record<string, unknown> = {}): Promise<unknown> => (await client.call(method, params))["result"];
      const info = (await q("getDocumentInfo")) as unknown as {
        bodies: number;
        revision: number;
      };
      expect(info.bodies).toBe(1);
      const desc = (await q("describeModel")) as unknown as {
        types: Record<string, number>;
      };
      expect(desc.types["Box"]).toBe(1);
      const feat = (await q("getFeature", { featureId: boxId })) as unknown as {
        type: string;
      };
      expect(feat.type).toBe("Box");
      const deps = (await q("getDependencies", { featureId: boxId })) as unknown as {
        dependsOn: { id: string; known: boolean }[];
      };
      expect(deps.dependsOn).toHaveLength(0);

      const set = (await q("setSelection", {
        ids: [`${boxId}:box.+Z`],
      })) as unknown as { ids: string[] };
      expect(set.ids).toHaveLength(1);
      const got = (await q("getSelection", {})) as unknown as {
        ids: string[];
      };
      expect(got.ids).toHaveLength(1);
      await expect(
        q("setSelection", { ids: ["ghost:box.+Z"] }),
      ).rejects.toMatchObject({ code: "BAD_PARAMS" });

      const found = (await q("findFaces", {
        ownerBody: boxId,
        role: "box.+Z",
      })) as unknown as {
        faces: { persistentFaceId: string; confidence: number }[];
      };
      expect(found.faces).toHaveLength(1);
      expect(found.faces[0]!.confidence).toBe(1.0);

      const manips = (await q("getManipulators", {
        featureId: boxId,
      })) as unknown as {
        manipulators: { id: string; type: string; parameter: string }[];
      };
      expect(manips.manipulators.map((m) => m.id)).toEqual([
        "width",
        "height",
        "depth",
      ]);

      const vol = (await q("measureVolume", { featureId: boxId })) as unknown as {
        volumeMm3: number;
      };
      expect(vol.volumeMm3).toBe(1);
      const area = (await q("measureArea", { featureId: boxId })) as unknown as {
        areaMm2: number;
      };
      expect(area.areaMm2).toBeCloseTo(200, 6);
      const dist = (await q("measureDistance", {
        a: `${boxId}:box.+Z`,
        b: `${boxId}:box.-Z`,
      })) as unknown as { distanceMm: number };
      expect(dist.distanceMm).toBeCloseTo(10, 6);
      const ang = (await q("measureAngle", {
        a: `${boxId}:box.+Z`,
        b: `${boxId}:box.-Z`,
      })) as unknown as { angleDeg: number };
      expect(ang.angleDeg).toBeCloseTo(180, 3);

      const valid = (await q("validateDocument", {})) as unknown as {
        valid: boolean;
        scope: string;
      };
      expect(valid.valid).toBe(true);
      expect(valid.scope).toBe("structural");

      const cmds = (await q("listCommands", {})) as unknown as {
        commands: { id: string }[];
      };
      expect(cmds.commands.map((c) => c.id)).toContain("CreateBox");
      await expect(q("getCommandSchema", { id: "CreateBox" })).rejects.toMatchObject({
        code: "NOT_IMPLEMENTED",
      });
      const caps = (await q("getCapabilities", {})) as unknown as {
        transactions: boolean;
        previews: boolean;
      };
      expect(caps.transactions).toBe(true);
      expect(caps.previews).toBe(true);
    } finally {
      client.closeRaw();
      relay.stop();
    }
  });

  it("spatial preview lifecycle: begin, update, commit in one undo", async () => {
    const { relay, client, boxId } = await bootBox();
    try {
      const q = async (method: string, params: Record<string, unknown> = {}): Promise<unknown> => (await client.call(method, params))["result"];
      const begun = (await q("previewBegin", {
        featureId: boxId,
        paramName: "widthMm",
        valueMm: 20,
      })) as unknown as { previewId: string; triangles: number };
      expect(typeof begun.previewId).toBe("string");
      expect(begun.triangles).toBe(4);
      const updated = (await q("previewUpdate", {
        previewId: begun.previewId,
        valueMm: 30,
      })) as unknown as { previewId: string };
      expect(updated.previewId).toBe(begun.previewId);
      const committed = (await q("previewCommit", {
        previewId: begun.previewId,
      })) as unknown as { revision: number };
      expect(committed.revision).toBeGreaterThan(0);
      // A consumed preview is gone: second commit (new requestId) is
      // NOT_FOUND, while a same-requestId retry would replay via dedup.
      const again = (await q("previewCommit", {
        previewId: begun.previewId,
      }).catch((e: Error) => e)) as unknown;
      expect(again).toMatchObject({ code: "NOT_FOUND" });
    } finally {
      client.closeRaw();
      relay.stop();
    }
  });

  it("multi-command transaction: atomic delta, owner rules, recovery", async () => {
    const fake = fakeSidecar();
    const relay = new SessionRelay(() => fake.manager);
    const port = await freePort();
    relay.start({ port, host: "127.0.0.1", token: TOKEN });
    const client = new SessionClient();
    await client.connect(TOKEN, port);
    const other = new SessionClient();
    await other.connect(TOKEN, port);
    try {
      const seenDeltas = (): Record<string, unknown>[] =>
        client.events.filter((e) => e["event"] === "delta");
      // Deltas skip their origin by design — observe on the other client.
      const otherDeltas = (): Record<string, unknown>[] =>
        other.events.filter((e) => e["event"] === "delta");

      // Txn control replies are flat like invoke (queries wrap {result}).
      const tcall = (method: string, params: Record<string, unknown> = {}) =>
        client.call(method, params);
      const tocall = (method: string, params: Record<string, unknown> = {}) =>
        other.call(method, params);

      // Begin + two joined creates: silent until commit (one atomic delta).
      await tcall("txnBegin", { transactionId: "t1" });
      await expect(tcall("txnBegin", { transactionId: "t2" })).rejects.toMatchObject({
        code: "TRANSACTION_BUSY",
      });
      // Outsider invoke without the unit id is fenced at the core.
      await expect(
        tocall("invoke", {
          documentId: "doc-phase1",
          type: 3,
          fields: { featureId: "box-out", widthMm: 1, heightMm: 1, depthMm: 1 },
        }),
      ).rejects.toMatchObject({ code: "BUSY" });
      await tcall("invoke", {
        documentId: "doc-phase1",
        type: 3,
        transactionId: "t1",
        fields: { featureId: "box-t1", widthMm: 1, heightMm: 1, depthMm: 1 },
      });
      await tcall("invoke", {
        documentId: "doc-phase1",
        type: 3,
        transactionId: "t1",
        fields: { featureId: "box-t2", widthMm: 2, heightMm: 2, depthMm: 2 },
      });
      expect(seenDeltas()).toHaveLength(0);
      const committed = (await tcall("txnCommit", { transactionId: "t1" })) as unknown as {
        revision: number;
      };
      expect(committed.revision).toBeGreaterThan(0);
      expect(otherDeltas()).toHaveLength(1);

      // Rollback path empties without committing.
      await tcall("txnBegin", { transactionId: "t2" });
      await tcall("invoke", {
        documentId: "doc-phase1",
        type: 3,
        transactionId: "t2",
        fields: { featureId: "box-t3", widthMm: 3, heightMm: 3, depthMm: 3 },
      });
      const rolled = (await tcall("txnRollback", { transactionId: "t2" })) as unknown as {
        features: { featureId: string }[];
      };
      expect(rolled.features.map((f) => f.featureId)).not.toContain("box-t3");

      // Status + owner rules.
      const status = (await tcall("txnStatus", {})) as unknown as { open: boolean };
      expect(status.open).toBe(false);
      await expect(
        tcall("txnCommit", { transactionId: "t9" }),
      ).rejects.toMatchObject({ code: "NO_TRANSACTION" });
    } finally {
      client.closeRaw();
      other.closeRaw();
      relay.stop();
    }
  });
});

describe("SessionControlContract (Slice 7)", () => {
  it("relay query surface matches the control-plane contract", () => {
    expect([...QUERY_METHODS]).toEqual([...QUERY_METHODS_CONTRACT]);
    for (const m of QUERY_METHODS) {
      expect(SESSION_CONTROL_METHODS).toContain(m as string);
    }
    for (const m of SESSION_CONTROL_METHODS) {
      expect(REQUIRED_PARAMS[m]).toBeDefined();
    }
  });

  it("every query method yields a correlated reply (ok or coded error)", async () => {
    const fake = fakeSidecar();
    const relay = new SessionRelay(() => fake.manager);
    const port = await freePort();
    relay.start({ port, host: "127.0.0.1", token: TOKEN });
    const client = new SessionClient();
    await client.connect(TOKEN, port);
    try {
      await client.call("invoke", {
        documentId: "doc-phase1",
        type: 3,
        fields: { featureId: "box-c", widthMm: 10, heightMm: 10, depthMm: 10 },
      });
      const box = "box-c";
      const face = `${box}:box.+Z`;
      const params: Record<string, Record<string, unknown>> = {
        getDocumentInfo: {},
        getBodies: {},
        getFeatures: {},
        getFeature: { featureId: box },
        getParameters: { featureId: box },
        getDependencies: { featureId: box },
        getModelTree: {},
        describeModel: {},
        getSelection: {},
        setSelection: { ids: [face] },
        clearSelection: {},
        findFaces: { ownerBody: box, role: "box.+Z" },
        findEdges: { ownerBody: box },
        findBodies: {},
        getManipulators: { featureId: box },
        measureVolume: { featureId: box },
        measureArea: { featureId: box },
        getBoundingBox: { featureId: box },
        measureDistance: { a: face, b: `${box}:box.-Z` },
        measureAngle: { a: face, b: `${box}:box.-Z` },
        measureRadius: { featureId: box },
        measureDiameter: { featureId: box },
        validateDocument: {},
        validateBody: { featureId: box },
        validateFeature: { featureId: box },
        listCommands: {},
        getCommandSchema: { id: "CreateBox" },
        getCapabilities: {},
        previewBegin: { featureId: box, paramName: "widthMm", valueMm: 20 },
        previewUpdate: {},
        previewCommit: {},
        previewCancel: {},
      };
      // previewUpdate/Commit/Cancel need a live previewId: drive the
      // lifecycle inline instead of the static table above.
      const begun = (await client.call("previewBegin", params["previewBegin"]!))[
        "result"
      ] as { previewId: string };
      expect(typeof begun.previewId).toBe("string");
      const cancelled = (await client.call("previewCancel", {
        previewId: begun.previewId,
      }))["result"] as { cancelled: boolean };
      expect(cancelled.cancelled).toBe(true);

      for (const m of QUERY_METHODS as readonly string[]) {
        if (
          m === "previewBegin" ||
          m === "previewUpdate" ||
          m === "previewCommit" ||
          m === "previewCancel"
        ) {
          continue;
        }
        try {
          const reply = await client.call(m, params[m] ?? {});
          expect(reply["requestId"]).toBeDefined();
          expect(reply["ok"]).toBe(true);
          if (m === "getCommandSchema") {
            throw new Error("getCommandSchema should reject");
          }
        } catch (e) {
          const code = (e as Error & { code?: string }).code;
          expect(typeof code).toBe("string");
          if (m === "getCommandSchema") {
            expect(code).toBe("NOT_IMPLEMENTED");
          } else {
            // Box has no radius: the call is valid wire, core says no.
            expect(["BAD_PARAMS", "NOT_FOUND"]).toContain(code);
          }
        }
      }
    } finally {
      client.closeRaw();
      relay.stop();
    }
  });

  it("missing required fields fail with errorCode + error (never hang)", async () => {
    const fake = fakeSidecar();
    const relay = new SessionRelay(() => fake.manager);
    const port = await freePort();
    relay.start({ port, host: "127.0.0.1", token: TOKEN });
    const client = new SessionClient();
    await client.connect(TOKEN, port);
    try {
      const cases: [string, Record<string, unknown>, string][] = [
        ["invoke", {}, "BAD_PARAMS"],
        ["txnBegin", {}, "BAD_PARAMS"],
        ["getFeature", {}, "BAD_PARAMS"],
        ["measureDistance", { a: "x:box.+Z" }, "BAD_PARAMS"],
        ["getCommandSchema", { id: "CreateBox" }, "NOT_IMPLEMENTED"],
        ["nope", {}, "NOT_IMPLEMENTED"],
      ];
      for (const [method, p, code] of cases) {
        const err = await client.call(method, p).then(
          () => null,
          (e: Error) => e as Error & { code?: string },
        );
        expect(err, method).not.toBeNull();
        expect(err!.code).toBe(code);
        expect(typeof err!.message).toBe("string");
      }
    } finally {
      client.closeRaw();
      relay.stop();
    }
  });
});

