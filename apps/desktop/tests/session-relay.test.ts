// Phase 11b relay logic, in-process (no Electron): hello pairing, snapshot,
// serialized mutations with feature locks, idempotent retries, revision
// fencing, delta broadcast. The sidecar is stubbed at the framed-bytes
// boundary with canned core JSON responses.

import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { SessionRelay } from "../electron/session";
import type { SidecarManager } from "../electron/sidecar";
import { SessionClient } from "../e2e/ws-test-client";

const PORT = 44991;
const TOKEN = "unit-token";

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
function fakeSidecar() {
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
  it("hello pairing, snapshot, invoke, undo broadcast, rejects", async () => {
    const fake = fakeSidecar();
    const deltas: unknown[] = [];
    const relay = new SessionRelay(() => fake.manager, (d) => {
      deltas.push(d);
    });
    relay.start({ port: PORT, host: "127.0.0.1", token: TOKEN });
    const client = new SessionClient();
    try {
      const hello = await client.connect(TOKEN, PORT);
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
    relay.start({ port: PORT + 1, host: "127.0.0.1", token: TOKEN });
    const raw = new WebSocket(`ws://127.0.0.1:${PORT + 1}`);
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
  const PORT_Q = 44993;

  async function bootBox(): Promise<{
    relay: SessionRelay;
    client: SessionClient;
    boxId: string;
  }> {
    const fake = fakeSidecar();
    const relay = new SessionRelay(() => fake.manager);
    relay.start({ port: PORT_Q, host: "127.0.0.1", token: TOKEN });
    const client = new SessionClient();
    await client.connect(TOKEN, PORT_Q);
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
    relay.start({ port: PORT_Q + 20, host: "127.0.0.1", token: TOKEN });
    const client = new SessionClient();
    await client.connect(TOKEN, PORT_Q + 20);
    const other = new SessionClient();
    await other.connect(TOKEN, PORT_Q + 20);
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
      ).rejects.toMatchObject({ code: "TRANSACTION_OPEN" });
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

