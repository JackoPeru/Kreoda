// Slice 6 TEST G (permanent): session APIs carry real Body semantics.
// Desktop opens a one-body model; a remote parameter edit keeps it 1 Body
// (not N historical shapes); both snapshots agree on bodies/tips; tip-change
// deltas name the body; stale clients are still fenced (no silent mutation).
//
// Harness mirrors session-relay.test.ts (fake sidecar at the framed-bytes
// boundary + the shared SessionClient from e2e/ws-test-client — the WS
// client itself is NOT duplicated here).

import { describe, expect, it } from "vitest";
import { createServer } from "node:net";
import { SessionRelay } from "../electron/session";
import type { SidecarManager } from "../electron/sidecar";
import { SessionClient } from "../e2e/ws-test-client";

const TOKEN = "slice6-token";

interface StoredFeature {
  featureId: string;
  type: string;
  paramsMm: number[];
  volumeMm3: number;
  dependsOn: string[];
  refExtra: string;
  expressions: Record<string, string>;
}

/** Fake core with Box→Hole→Fillet history + in-place param edits + undo. */
function fakeBodySidecar() {
  const features = new Map<string, StoredFeature>();
  const undoStates: StoredFeature[][] = [];
  const redoStates: StoredFeature[][] = [];
  const snapshot = (): StoredFeature[] => JSON.parse(JSON.stringify([...features.values()]));
  const remember = (): void => { undoStates.push(snapshot()); redoStates.length = 0; };
  let revision = 0;
  const paramIndex = (type: string, name: string): number => {
    const tables: Record<string, Record<string, number>> = {
      Box: { widthMm: 0, heightMm: 1, depthMm: 2 },
      Hole: { diameterMm: 0, depthMm: 1 },
      Fillet: { radiusMm: 0 },
    };
    return tables[type]?.[name] ?? -1;
  };
  const invoke = async (frame: Uint8Array): Promise<Uint8Array> => {
    const envelope = JSON.parse(
      new TextDecoder().decode(frame.slice(4)),
    ) as {
      requestId: string;
      documentId: string;
      type: number;
      featureId?: string;
      targetId?: string;
      paramName?: string;
      valueMm?: number;
      widthMm?: number;
      heightMm?: number;
      depthMm?: number;
      diameterMm?: number;
      radiusMm?: number;
    };
    const respond = (body: Record<string, unknown>): Uint8Array =>
      new TextEncoder().encode(
        JSON.stringify({
          protocolVersion: 1,
          requestId: envelope.requestId,
          ...body,
        }),
      );
    if (envelope.type === 26) {
      return respond({
        status: "ok",
        features: [...features.values()],
        sketches: [],
        revision,
      });
    }
    if (envelope.type === 3) {
      remember();
      revision += 1;
      const rec: StoredFeature = {
        featureId: envelope.featureId ?? "box-x",
        type: "Box",
        paramsMm: [envelope.widthMm ?? 0, envelope.heightMm ?? 0, envelope.depthMm ?? 0],
        volumeMm3: (envelope.widthMm ?? 0) * (envelope.heightMm ?? 0) * (envelope.depthMm ?? 0),
        dependsOn: [],
        refExtra: "",
        expressions: {},
      };
      features.set(rec.featureId, rec);
      return respond({ status: "ok", ...rec, revision });
    }
    if (envelope.type === 20) {
      remember();
      revision += 1;
      const target = envelope.targetId ?? "";
      const rec: StoredFeature = {
        featureId: envelope.featureId ?? "hole-x",
        type: "Hole",
        paramsMm: [envelope.diameterMm ?? 0, envelope.depthMm ?? 0],
        volumeMm3: 1,
        dependsOn: target ? [target] : [],
        refExtra: "",
        expressions: {},
      };
      features.set(rec.featureId, rec);
      return respond({ status: "ok", ...rec, revision });
    }
    if (envelope.type === 21) {
      remember();
      revision += 1;
      const target = envelope.targetId ?? "";
      const rec: StoredFeature = {
        featureId: envelope.featureId ?? "fillet-x",
        type: "Fillet",
        paramsMm: [envelope.radiusMm ?? 0],
        volumeMm3: 1,
        dependsOn: target ? [target] : [],
        refExtra: "",
        expressions: {},
      };
      features.set(rec.featureId, rec);
      return respond({ status: "ok", ...rec, revision });
    }
    if (envelope.type === 6) {
      const rec = envelope.featureId ? features.get(envelope.featureId) : undefined;
      if (!rec) {
        return respond({
          status: "error",
          errorCode: "NOT_FOUND",
          errorMessage: "unknown feature",
        });
      }
      const idx =
        typeof envelope.paramName === "string"
          ? paramIndex(rec.type, envelope.paramName)
          : -1;
      if (idx < 0 || typeof envelope.valueMm !== "number") {
        return respond({
          status: "error",
          errorCode: "BAD_PARAMS",
          errorMessage: "unknown parameter",
        });
      }
      remember();
      revision += 1;
      rec.paramsMm[idx] = envelope.valueMm;
      if (rec.type === "Box") {
        rec.volumeMm3 = rec.paramsMm[0]! * rec.paramsMm[1]! * rec.paramsMm[2]!;
      }
      return respond({
        status: "ok",
        features: [...features.values()],
        sketches: [],
        revision,
      });
    }
    if (envelope.type === 8 || envelope.type === 9) {
      const from = envelope.type === 8 ? undoStates : redoStates;
      const to = envelope.type === 8 ? redoStates : undoStates;
      const prior = from.pop();
      if (prior) {
        to.push(snapshot());
        features.clear();
        for (const feature of prior) features.set(feature.featureId, feature);
      }
      revision += 1;
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
  return { manager: { invoke } as unknown as SidecarManager };
}

interface SessionBodyWire {
  bodyId: string;
  tip: string;
  history: string[];
}

async function bootPair(incremental = false, manager?: SidecarManager): Promise<{
  relay: SessionRelay;
  desktop: SessionClient;
  remote: SessionClient;
}> {
  const allocation = createServer();
  await new Promise<void>((resolve, reject) => {
    allocation.once("error", reject);
    allocation.listen(0, "127.0.0.1", resolve);
  });
  const address = allocation.address();
  if (!address || typeof address === "string") throw new Error("no test port");
  const port = address.port;
  await new Promise<void>((resolve) => allocation.close(() => resolve()));
  const fake = fakeBodySidecar();
  const relay = new SessionRelay(() => manager ?? fake.manager);
  relay.start({ port, host: "127.0.0.1", token: TOKEN });
  const desktop = new SessionClient();
  const capabilities = incremental ? ["incremental-deltas"] : undefined;
  await desktop.connect(TOKEN, port, undefined, capabilities);
  const remote = new SessionClient();
  await remote.connect(TOKEN, port, undefined, capabilities);
  return { relay, desktop, remote };
}

async function buildBoxHoleFillet(
  remote: SessionClient,
  boxId: string,
  holeId: string,
  filletId: string,
): Promise<void> {
  await remote.call("invoke", {
    documentId: "doc-phase1",
    type: 3,
    fields: { featureId: boxId, widthMm: 100, heightMm: 60, depthMm: 10 },
  });
  await remote.call("invoke", {
    documentId: "doc-phase1",
    type: 20,
    fields: { featureId: holeId, targetId: boxId, faceRole: "box.+Z", diameterMm: 8, depthMm: 10 },
  });
  await remote.call("invoke", {
    documentId: "doc-phase1",
    type: 21,
    fields: { featureId: filletId, targetId: holeId, edgeIds: [`${holeId}:box.+Z&+X`], radiusMm: 2 },
  });
}

describe("Slice 6 TEST G: session Body semantics", () => {
  it("compares canonical sketch coordinates despite equal counts and propagates to dependent meshes", async () => {
    let revision = 10;
    let model = { points: [{ id: "p", x: 0, y: 0 }], lines: [], circles: [], constraints: [] };
    const manager = { invoke: async (frame: Uint8Array) => {
      const request = JSON.parse(Buffer.from(frame).subarray(4).toString()) as Record<string, unknown>;
      let payload: Record<string, unknown>;
      if (request["type"] === 26) {
        payload = {
          features: [
            { featureId: "extrude", type: "Extrude", paramsMm: [10], volumeMm3: 1, dependsOn: ["sk"] },
            { featureId: "occurrence", type: "Instance", paramsMm: [100, 0, 0], volumeMm3: 1, dependsOn: ["extrude"] },
          ],
          sketches: [{ featureId: "sk", planeKind: "XY", points: 1, lines: 0, circles: 0, constraints: 0 }],
        };
      } else if (request["type"] === 17) {
        payload = { sketch: { id: "sk", planeKind: "XY", model } };
      } else if (request["type"] === 14) {
        model = request["model"] as typeof model;
        revision += 1;
        payload = {};
      } else if (request["type"] === 8) {
        model = { ...model, points: [{ id: "p", x: 0, y: 0 }] };
        revision += 1;
        payload = {};
      } else throw new Error(`unexpected fixture command: ${request["type"]}`);
      return Buffer.from(JSON.stringify({ protocolVersion: 1, requestId: request["requestId"], status: "ok", revision, ...payload }));
    } } as unknown as SidecarManager;
    const { relay, desktop, remote } = await bootPair(true, manager);
    try {
      for (const type of [14, 8]) {
        const result = await remote.call("invoke", { type, fields: { featureId: "sk", model: { ...model, points: [{ id: "p", x: 1, y: 0 }] } } });
        const event = await desktop.waitDelta(result["revision"] as number) as unknown as Record<string, unknown>;
        expect(event["changedMeshIds"]).toEqual(["extrude", "occurrence"]);
        expect(event["updated"]).toEqual(expect.arrayContaining([
          expect.objectContaining({ kind: "sketch", id: "sk", value: expect.objectContaining({ points: 1, model }) }),
          expect.objectContaining({ kind: "feature", id: "extrude" }),
          expect.objectContaining({ kind: "feature", id: "occurrence" }),
        ]));
      }
    } finally { desktop.closeRaw(); remote.closeRaw(); relay.stop(); }
  });
  it("invalidates an unchanged body tip on parameter edit, Undo and Redo", async () => {
    const { relay, desktop, remote } = await bootPair(true);
    try {
      const created = await remote.call("invoke", {
        type: 3,
        fields: { featureId: "edited-box", widthMm: 10, heightMm: 10, depthMm: 10 },
      });
      const edited = await remote.call("invoke", {
        type: 6,
        fields: { featureId: "edited-box", paramName: "widthMm", valueMm: 12 },
      });
      const editDelta = await desktop.waitDelta(edited["revision"] as number) as unknown as Record<string, unknown>;
      expect(editDelta["baseRevision"]).toBe(created["revision"]);
      expect(editDelta["changedMeshIds"]).toEqual(["edited-box"]);
      for (const type of [8, 9]) {
        const result = await remote.call("invoke", { type, fields: {} });
        const wire = await desktop.waitDelta(result["revision"] as number) as unknown as Record<string, unknown>;
        expect(wire["changedMeshIds"]).toEqual(["edited-box"]);
        expect(wire["updated"]).toEqual(expect.arrayContaining([
          expect.objectContaining({ kind: "feature", id: "edited-box" }),
        ]));
        expect(wire["added"]).toEqual([]);
        expect(wire["removedIds"]).toEqual([]);
      }
    } finally {
      desktop.closeRaw(); remote.closeRaw(); relay.stop();
    }
  });
  it("seeds before first mutation and emits incremental wire without full arrays", async () => {
    const { relay, desktop, remote } = await bootPair(true);
    try {
      const created = await remote.call("invoke", {
        documentId: "doc-phase1",
        type: 3,
        fields: { featureId: "box-incremental", widthMm: 10, heightMm: 10, depthMm: 10 },
      });
      const wire = await desktop.waitDelta(created["revision"] as number) as unknown as Record<string, unknown>;
      expect(wire).toMatchObject({
        event: "delta",
        baseRevision: 0,
        newRevision: created["revision"],
        revision: created["revision"],
        sessionId: expect.any(String),
        documentId: "doc-phase1",
        originClientId: expect.any(String),
        changedMeshIds: ["box-incremental"],
        referenceRemaps: [],
        warnings: [],
      });
      for (const fullField of ["features", "sketches", "bodies", "tips"]) {
        expect(Object.hasOwn(wire, fullField)).toBe(false);
      }
      expect(wire["added"]).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "feature", id: "box-incremental", index: 0 }),
        expect.objectContaining({ kind: "body", id: "body-box-incremental", index: 0 }),
      ]));
      expect(remote.events.some((event) => event["event"] === "delta")).toBe(true);
    } finally {
      desktop.closeRaw();
      remote.closeRaw();
      relay.stop();
    }
  });

  it("one-body model stays 1 Body across history + remote param edit; snapshots agree", async () => {
    const { relay, desktop, remote } = await bootPair();
    try {
      const boxId = "box-g";
      const holeId = "hole-g";
      const filletId = "fillet-g";
      await buildBoxHoleFillet(remote, boxId, holeId, filletId);

      // 3 historical shapes collapse into 1 Body with the fillet tip.
      const bodies = (await remote.call("getBodies", {})) as unknown as {
        result: { bodies: SessionBodyWire[]; tips: string[]; revision: number };
      };
      expect(bodies.result.bodies).toHaveLength(1);
      expect(bodies.result.bodies[0]).toEqual({
        bodyId: `body-${boxId}`,
        tip: filletId,
        history: [boxId, holeId, filletId],
      });
      expect(bodies.result.tips).toEqual([filletId]);

      // Feature history is intact (per body), not flattened away.
      const feats = (await remote.call("getFeatures", {})) as unknown as {
        result: {
          features: { featureId: string }[];
          bodies: SessionBodyWire[];
        };
      };
      expect(feats.result.features.map((f) => f.featureId)).toEqual([
        boxId,
        holeId,
        filletId,
      ]);
      expect(feats.result.bodies).toHaveLength(1);
      const scoped = (await remote.call("getFeatures", {
        bodyId: `body-${boxId}`,
      })) as unknown as {
        result: { tip: string; history: string[]; features: { featureId: string }[] };
      };
      expect(scoped.result.tip).toBe(filletId);
      expect(scoped.result.features).toHaveLength(3);

      // Desktop snapshot agrees with the remote one (bodies/tips match).
      const remoteSnap = (await remote.call("snapshot", {})) as unknown as {
        bodies: SessionBodyWire[];
        tips: string[];
        revision: number;
      };
      const deskSnap = (await desktop.call("snapshot", {})) as unknown as {
        bodies: SessionBodyWire[];
        tips: string[];
        revision: number;
      };
      expect(deskSnap.bodies).toEqual(remoteSnap.bodies);
      expect(deskSnap.tips).toEqual(remoteSnap.tips);
      expect(deskSnap.revision).toBe(remoteSnap.revision);

      // Remote changes a parameter: still 1 Body, same tip, revision advances.
      const revBefore = remoteSnap.revision;
      const edited = await remote.call("invoke", {
        documentId: "doc-phase1",
        type: 6,
        baseRevision: revBefore,
        fields: { featureId: boxId, paramName: "widthMm", valueMm: 50 },
      });
      expect((edited["revision"] as number)).toBeGreaterThan(revBefore);
      const after = (await desktop.call("getBodies", {})) as unknown as {
        result: { bodies: SessionBodyWire[] };
      };
      expect(after.result.bodies).toHaveLength(1);
      expect(after.result.bodies[0]).toEqual({
        bodyId: `body-${boxId}`,
        tip: filletId,
        history: [boxId, holeId, filletId],
      });
    } finally {
      desktop.closeRaw();
      remote.closeRaw();
      relay.stop();
    }
  });

  it("tip-change delta names the body (not N features) + undo names disappeared ids", async () => {
    const { relay, desktop, remote } = await bootPair();
    try {
      const boxId = "box-d";
      const holeId = "hole-d";
      await remote.call("invoke", {
        documentId: "doc-phase1",
        type: 3,
        fields: { featureId: boxId, widthMm: 10, heightMm: 10, depthMm: 10 },
      });
      desktop.events.length = 0;
      const holed = await remote.call("invoke", {
        documentId: "doc-phase1",
        type: 20,
        fields: { featureId: holeId, targetId: boxId, faceRole: "box.+Z", diameterMm: 4, depthMm: 5 },
      });
      const holeRev = holed["revision"] as number;
      const delta = await desktop.waitDelta(holeRev);
      const wire = delta as unknown as {
        bodies: SessionBodyWire[];
        tips: string[];
        changedBodyIds: string[];
        changedMeshIds: string[];
        disappearedIds: string[];
        revision: number;
      };
      expect(wire.revision).toBe(holeRev);
      expect(wire.bodies).toHaveLength(1);
      expect(wire.tips).toEqual([holeId]);
      // The tip change names the ONE body — not the N historical features.
      expect(wire.changedBodyIds).toEqual([`body-${boxId}`]);
      expect(wire.changedMeshIds).toEqual([holeId]);
      expect(wire.disappearedIds).toEqual([]);

      // Undo drops the hole: the delta carries the disappeared id + the
      // body retipped to the box.
      const undone = await remote.call("invoke", {
        documentId: "doc-phase1",
        type: 8,
        fields: {},
      });
      const undoRev = undone["revision"] as number;
      const undoDelta = (await desktop.waitDelta(undoRev)) as unknown as {
        bodies: SessionBodyWire[];
        tips: string[];
        changedBodyIds: string[];
        disappearedIds: string[];
      };
      expect(undoDelta.disappearedIds).toContain(holeId);
      expect(undoDelta.bodies).toHaveLength(1);
      expect(undoDelta.tips).toEqual([boxId]);
      expect(undoDelta.changedBodyIds).toEqual([`body-${boxId}`]);
    } finally {
      desktop.closeRaw();
      remote.closeRaw();
      relay.stop();
    }
  });

  it("stale client must not mutate silently (revision fencing preserved)", async () => {
    const { relay, desktop, remote } = await bootPair();
    try {
      await remote.call("invoke", {
        documentId: "doc-phase1",
        type: 3,
        fields: { featureId: "box-f", widthMm: 10, heightMm: 10, depthMm: 10 },
      });
      const snap = (await remote.call("snapshot", {})) as unknown as {
        revision: number;
        features: unknown[];
      };
      await expect(
        remote.call("invoke", {
          documentId: "doc-phase1",
          type: 6,
          baseRevision: snap.revision + 100,
          fields: { featureId: "box-f", paramName: "widthMm", valueMm: 99 },
        }),
      ).rejects.toMatchObject({ code: "NEED_FULL_SNAPSHOT" });
      // Nothing mutated: same revision, same single body.
      const after = (await desktop.call("snapshot", {})) as unknown as {
        revision: number;
        features: unknown[];
        bodies: SessionBodyWire[];
      };
      expect(after.revision).toBe(snap.revision);
      expect(after.features).toHaveLength(snap.features.length);
      expect(after.bodies).toHaveLength(1);
    } finally {
      desktop.closeRaw();
      remote.closeRaw();
      relay.stop();
    }
  });
});
