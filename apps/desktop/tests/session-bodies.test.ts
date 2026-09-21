// Slice 6 TEST G (permanent): session APIs carry real Body semantics.
// Desktop opens a one-body model; a remote parameter edit keeps it 1 Body
// (not N historical shapes); both snapshots agree on bodies/tips; tip-change
// deltas name the body; stale clients are still fenced (no silent mutation).
//
// Harness mirrors session-relay.test.ts (fake sidecar at the framed-bytes
// boundary + the shared SessionClient from e2e/ws-test-client — the WS
// client itself is NOT duplicated here).

import { describe, expect, it } from "vitest";
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
    if (envelope.type === 8) {
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
  return { manager: { invoke } as unknown as SidecarManager };
}

interface SessionBodyWire {
  bodyId: string;
  tip: string;
  history: string[];
}

async function bootPair(port: number): Promise<{
  relay: SessionRelay;
  desktop: SessionClient;
  remote: SessionClient;
}> {
  const fake = fakeBodySidecar();
  const relay = new SessionRelay(() => fake.manager);
  relay.start({ port, host: "127.0.0.1", token: TOKEN });
  const desktop = new SessionClient();
  await desktop.connect(TOKEN, port);
  const remote = new SessionClient();
  await remote.connect(TOKEN, port);
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
    fields: { featureId: holeId, targetId: boxId, diameterMm: 8, depthMm: 10 },
  });
  await remote.call("invoke", {
    documentId: "doc-phase1",
    type: 21,
    fields: { featureId: filletId, targetId: holeId, radiusMm: 2 },
  });
}

describe("Slice 6 TEST G: session Body semantics", () => {
  it("one-body model stays 1 Body across history + remote param edit; snapshots agree", async () => {
    const { relay, desktop, remote } = await bootPair(44995);
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
    const { relay, desktop, remote } = await bootPair(44996);
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
        fields: { featureId: holeId, targetId: boxId, diameterMm: 4, depthMm: 5 },
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
    const { relay, desktop, remote } = await bootPair(44997);
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
