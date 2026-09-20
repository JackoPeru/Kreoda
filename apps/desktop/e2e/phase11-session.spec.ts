// Phase 11 acceptance (§11.17): Desktop + a second network client share one
// authoritative session with no GUI automation on the second side.
// Desktop opens → network client joins + snapshots → network client mutates
// → Desktop updates → Desktop undoes → network client observes → revisions
// match → reconnect recovers → invalid/stale calls rejected safely.
//
// Uses KREODA_SESSION_PORT/TOKEN (relay stays off for every other spec, so
// no port collisions across workers).

import { test, expect, _electron as electron, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import path from "node:path";
import os from "node:os";

const HERE = import.meta.dirname;
const MAIN = path.join(HERE, "..", ".vite", "build", "main.cjs");
const PORT = 44731;
const TOKEN = "s11-acceptance-token";
const RECOVERY_DIR = path.join(os.tmpdir(), "kreoda-phase11-session-e2e");

interface BodySnapshot {
  id: string;
  type: string;
  paramsMm: number[];
  volumeMm3: number;
}
interface Snapshot {
  revision: number;
  bodies: BodySnapshot[];
}

/** Minimal JSON session client (the Quest/agent shape, over WebSocket). */
class SessionClient {
  private ws: WebSocket | null = null;
  private seq = 0;
  private pending = new Map<
    string,
    { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }
  >();
  readonly events: Record<string, unknown>[] = [];

  async connect(token: string): Promise<Record<string, unknown>> {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
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

function snapOf(window: Page): Promise<Snapshot> {
  return window.evaluate(() =>
    (
      window as unknown as {
        __kreoda_test: { snapshot: () => Snapshot };
      }
    ).__kreoda_test.snapshot(),
  ) as Promise<Snapshot>;
}

test("unified session: join, mutate, desktop sync, undo, resync, rejects", async () => {
  const env = {
    ...process.env,
    KREODA_SESSION_PORT: String(PORT),
    KREODA_SESSION_TOKEN: TOKEN,
    KREODA_RECOVERY_DIR: RECOVERY_DIR,
  };
  const app = await electron.launch({ args: [MAIN, "--no-sandbox"], env });
  const client = new SessionClient();
  try {
    // 1. Desktop opens a (fresh, empty) document.
    const window = await app.firstWindow({ timeout: 30000 });
    await window.waitForLoadState("domcontentloaded");
    await expect(window.getByText(/core 0\.1\.0/)).toBeVisible({
      timeout: 20000,
    });

    // 2. Second client connects over the network protocol.
    const hello = await client.connect(TOKEN);
    expect(typeof hello["clientId"]).toBe("string");
    expect(hello["documentId"]).toBe("doc-phase1");
    expect(hello["revision"]).toBe(0);

    // 3. Full snapshot on join (empty model).
    const empty = (await client.call("snapshot", {})) as {
      features: unknown[];
      revision: number;
    };
    expect(empty.features).toHaveLength(0);

    // 4. Second client changes a parameter of the shared model: it creates
    // a box through the typed core command (type 3 = CreateBox).
    const boxId = `box-${randomUUID()}`;
    const created = await client.call("invoke", {
      documentId: "doc-phase1",
      type: 3,
      fields: { featureId: boxId, widthMm: 100, heightMm: 60, depthMm: 10 },
    });
    expect(created["featureId"]).toBe(boxId);
    const rev1 = created["revision"] as number;
    expect(rev1).toBeGreaterThan(0);

    // 5. Desktop receives the delta and updates with no reload.
    await expect
      .poll(async () => ((await snapOf(window)) as Snapshot).bodies.length, {
        timeout: 30000,
      })
      .toBe(1);
    await expect(window.getByText(/Box 100×60×10/).first()).toBeVisible({
      timeout: 10000,
    });
    const desk = (await snapOf(window)) as Snapshot;
    expect(desk.bodies[0]!.id).toBe(boxId);
    expect(desk.bodies[0]!.volumeMm3).toBeCloseTo(60000, 3);

    // 6. Desktop performs Undo; the second client receives the delta.
    await window.locator('button[title^="Undo"]').click();
    const undone = await client.waitDelta(rev1 + 1);
    expect(undone.features).toHaveLength(0);
    await expect
      .poll(async () => ((await snapOf(window)) as Snapshot).bodies.length, {
        timeout: 20000,
      })
      .toBe(0);

    // Redo restores on both sides (same revision everywhere).
    await window.locator('button[title^="Redo"]').click();
    const redone = await client.waitDelta(rev1 + 2);
    expect(redone.features.map((b) => b.featureId)).toContain(boxId);

    // 7. Both clients on the same revision.
    const relaySnap = (await client.call("snapshot", {})) as {
      revision: number;
    };
    const deskSnap = (await snapOf(window)) as Snapshot;
    expect(deskSnap.revision).toBe(relaySnap.revision);

    // 8. Disconnect + reconnect recovers the same state.
    await client.closed();
    const client2 = new SessionClient();
    try {
      const hello2 = await client2.connect(TOKEN);
      expect(hello2["revision"]).toBe(relaySnap.revision);
      const re = (await client2.call("snapshot", {})) as {
        features: { featureId: string }[];
      };
      expect(re.features.map((b) => b.featureId)).toContain(boxId);
    } finally {
      client2.closeRaw();
    }

    // 9. Invalid and stale mutations are rejected safely.
    const evil = new SessionClient();
    try {
      await evil.connect("wrong-token");
      throw new Error("bad token was accepted");
    } catch (e) {
      // Either the socket closed (no hello reply) or hello errored.
      expect(String(e)).not.toContain("bad token was accepted");
    } finally {
      evil.closeRaw();
    }
    const client3 = new SessionClient();
    try {
      await client3.connect(TOKEN);
      await expect(
        client3.call("invoke", {
          documentId: "doc-phase1",
          type: 3,
          baseRevision: 999999,
          fields: {
            featureId: `box-${randomUUID()}`,
            widthMm: 10,
            heightMm: 10,
            depthMm: 10,
          },
        }),
      ).rejects.toMatchObject({ code: "NEED_FULL_SNAPSHOT" });
      await expect(
        client3.call("frobnicate", {}),
      ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
      await expect(
        client3.call("invoke", {
          documentId: "doc-phase1",
          type: 999,
          fields: {},
        }),
      ).rejects.toThrow();
    } finally {
      client3.closeRaw();
    }

    await window.screenshot({ path: path.join(HERE, "phase11-session.png") });
  } finally {
    client.closeRaw();
    await app.close();
  }
});

test("session transaction: two creates commit as one undo step", async () => {
  const env = {
    ...process.env,
    KREODA_SESSION_PORT: String(PORT),
    KREODA_SESSION_TOKEN: TOKEN,
    KREODA_RECOVERY_DIR: RECOVERY_DIR,
  };
  const app = await electron.launch({ args: [MAIN, "--no-sandbox"], env });
  const client = new SessionClient();
  try {
    const window = await app.firstWindow({ timeout: 30000 });
    await window.waitForLoadState("domcontentloaded");
    await expect(window.getByText(/core 0\.1\.0/)).toBeVisible({
      timeout: 20000,
    });
    await client.connect(TOKEN);

    const txnId = `txn-${randomUUID()}`;
    await client.call("txnBegin", { transactionId: txnId });
    const boxA = `box-${randomUUID()}`;
    const boxB = `box-${randomUUID()}`;
    for (const [id, w] of [[boxA, 10], [boxB, 20]] as const) {
      await client.call("invoke", {
        documentId: "doc-phase1",
        type: 3,
        transactionId: txnId,
        fields: { featureId: id, widthMm: w, heightMm: 10, depthMm: 10 },
      });
    }
    await client.call("txnCommit", { transactionId: txnId });

    // Both boxes land on Desktop through the single atomic delta.
    await expect
      .poll(async () => ((await snapOf(window)) as Snapshot).bodies.length, {
        timeout: 30000,
      })
      .toBe(2);
    // Exactly ONE Undo removes both: the transaction committed one delta.
    await window.locator('button[title^="Undo"]').click();
    await expect
      .poll(async () => ((await snapOf(window)) as Snapshot).bodies.length, {
        timeout: 20000,
      })
      .toBe(0);
    const status = (await client.call("txnStatus", {})) as {
      open: boolean;
    };
    expect(status.open).toBe(false);
  } finally {
    client.closeRaw();
    await app.close();
  }
});

test("session queries run against the real core", async () => {
  const env = {
    ...process.env,
    KREODA_SESSION_PORT: String(PORT),
    KREODA_SESSION_TOKEN: TOKEN,
    KREODA_RECOVERY_DIR: RECOVERY_DIR,
  };
  const app = await electron.launch({ args: [MAIN, "--no-sandbox"], env });
  const client = new SessionClient();
  try {
    const window = await app.firstWindow({ timeout: 30000 });
    await window.waitForLoadState("domcontentloaded");
    await expect(window.getByText(/core 0\.1\.0/)).toBeVisible({
      timeout: 20000,
    });

    // A real box through the desktop path (exact B-Rep + tessellation).
    const input = window.getByTestId("command-input");
    await input.fill("box 100 60 10");
    await input.press("Enter");
    const preview = window.getByTestId("plan-preview");
    await expect(preview).toBeVisible({ timeout: 5000 });
    await preview.getByRole("button", { name: /Run 1 step/ }).click();
    await expect
      .poll(async () => ((await snapOf(window)) as Snapshot).bodies.length, {
        timeout: 30000,
      })
      .toBe(1);
    const boxId = ((await snapOf(window)) as Snapshot).bodies[0]!.id;

    await client.connect(TOKEN);
    const q = async (method: string, params: Record<string, unknown> = {}) =>
      ((await client.call(method, params)) as { result: unknown }).result as never;

    const manips = (await q("getManipulators", {
      featureId: boxId,
    })) as {
      manipulators: {
        id: string;
        type: string;
        parameter: string;
        axis: [number, number, number];
      }[];
    };
    expect(manips.manipulators.map((m) => m.id)).toEqual([
      "width",
      "height",
      "depth",
    ]);
    expect(manips.manipulators[0]!.axis).toEqual([1, 0, 0]);

    const found = (await q("findFaces", {
      ownerBody: boxId,
      role: "box.+Z",
    })) as {
      faces: { persistentFaceId: string; confidence: number }[];
    };
    expect(found.faces.length).toBeGreaterThan(0);
    expect(found.faces[0]!.confidence).toBe(1.0);

    const vol = (await q("measureVolume", { featureId: boxId })) as {
      volumeMm3: number;
    };
    expect(vol.volumeMm3).toBeCloseTo(60000, 3);
    const area = (await q("measureArea", { featureId: boxId })) as {
      areaMm2: number;
    };
    expect(area.areaMm2).toBeCloseTo(2 * (100 * 60 + 100 * 10 + 60 * 10), 0);
    const bbox = (await q("getBoundingBox", { featureId: boxId })) as {
      bboxMm: number[];
    };
    // OCCT bboxes can report -0.0 on min faces; +0 normalizes it.
    expect(bbox.bboxMm.map((v) => Math.round(v) + 0)).toEqual([0, 0, 0, 100, 60, 10]);

    // Spatial preview lifecycle on the real kernel: preview, commit (one
    // undo), undo restores.
    const begun = (await q("previewBegin", {
      featureId: boxId,
      paramName: "widthMm",
      valueMm: 200,
    })) as { previewId: string; triangles: number };
    expect(typeof begun.previewId).toBe("string");
    expect(begun.triangles).toBeGreaterThan(0);
    await q("previewCommit", { previewId: begun.previewId });
    await expect
      .poll(async () => {
        const cur = (await snapOf(window)) as Snapshot;
        return cur.bodies.find((b) => b.id === boxId)!.paramsMm[0];
      }, { timeout: 30000 })
      .toBeCloseTo(200, 6);
    await window.locator('button[title^="Undo"]').click();
    await expect
      .poll(async () => {
        const cur = (await snapOf(window)) as Snapshot;
        return cur.bodies.find((b) => b.id === boxId)!.paramsMm[0];
      }, { timeout: 20000 })
      .toBeCloseTo(100, 6);

    const valid = (await q("validateDocument", {})) as {
      valid: boolean;
      scope: string;
    };
    expect(valid.valid).toBe(true);
    expect(valid.scope).toBe("structural");
  } finally {
    client.closeRaw();
    await app.close();
  }
});


