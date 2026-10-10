// Phase 11 acceptance (§11.17): Desktop + a second network client share one
// authoritative session with no GUI automation on the second side.
// Desktop opens → network client joins + snapshots → network client mutates
// → Desktop updates → Desktop undoes → network client observes → revisions
// match → reconnect recovers → invalid/stale calls rejected safely.
//
// Uses KREODA_SESSION_PORT/TOKEN (relay stays off for every other spec, so
// no port collisions across workers).

import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { MAIN } from "./helpers";
import { HERE, boot, openProject, runBar, snapOf } from "./helpers";
import { SessionClient } from "./ws-test-client";

const PORT = 44731;
const TOKEN = "s11-acceptance-token";
const RECOVERY_DIR = path.join(os.tmpdir(), "kreoda-phase11-session-e2e");

// This acceptance deliberately sends no mouse or keyboard actions: both
// clients use the production IPC/WebSocket entry points and the real OCCT core.
test("unified session: saved document, paired client, existing edit, Desktop undo, reconnect and rejects without GUI input", async () => {
  const profile = mkdtempSync(path.join(os.tmpdir(), "kreoda-session-acceptance-"));
  const app = await electron.launch({
    executablePath: createRequire(import.meta.url)("electron") as string,
    args: [MAIN, "--no-sandbox", "--lang=en-US", `--user-data-dir=${profile}`],
    env: { ...process.env, KREODA_SESSION_PORT: "", KREODA_SESSION_TOKEN: "", KREODA_RECOVERY_DIR: profile },
  });
  const clients: SessionClient[] = [];
  const checks: string[] = [];
  try {
    const window = await app.firstWindow();
    await expect.poll(() => window.evaluate(() => !!(window as unknown as { __kreoda_test?: unknown }).__kreoda_test)).toBe(true);
    await expect.poll(() => window.evaluate(() => globalThis.window.kreoda.coreInfo().then(info => info.running))).toBe(true);
    await window.evaluate(() => (window as unknown as { __kreoda_test: { openWorkspace(): void } }).__kreoda_test.openWorkspace());
    await expect(window.getByTestId("workspace-chrome")).toBeVisible();
    const local = (type: number, fields: Record<string, unknown> = {}) => window.evaluate(async ({ type, fields }) => {
      const payload = new TextEncoder().encode(JSON.stringify({ protocolVersion: 1, requestId: crypto.randomUUID(), documentId: "doc-phase1", type, ...fields }));
      const framed = new Uint8Array(payload.length + 4);
      new DataView(framed.buffer).setUint32(0, payload.length, true);
      framed.set(payload, 4);
      const reply = await globalThis.window.kreoda.invoke(btoa(Array.from(framed, b => String.fromCharCode(b)).join("")));
      return JSON.parse(atob(reply)) as Record<string, unknown>;
    }, { type, fields });
    const kernel = await local(1);
    expect(kernel["occtVersion"]).toBe("8.0.1-native");
    expect((await local(2))["status"]).toBe("ok");
    expect(await local(3, { featureId: "unsupported-preview", widthMm: 10, heightMm: 10, depthMm: 10, isPreview: true }))
      .toMatchObject({ status: "error", errorCode: "BAD_PARAMS" });
    expect((await local(26))["features"]).toEqual([]);
    checks.push("unsupported-local-preview-preserves-native-document");
    for (const featureId of ["box", "untouched"])
      expect((await local(3, { featureId, widthMm: 20, heightMm: 30, depthMm: 10 }))["status"]).toBe("ok");
    await expect.poll(async () => (await snapOf(window)).bodies.filter(b => b.triangles > 0).length).toBe(2);
    const saved = path.join(profile, "saved-session.icad");
    await window.evaluate(saved => (window as unknown as { __kreoda_test: { saveIcad(path: string): Promise<unknown> } }).__kreoda_test.saveIcad(saved), saved);
    expect((await local(2))["status"]).toBe("ok");
    await expect.poll(async () => (await snapOf(window)).bodies.length).toBe(0);
    await window.evaluate(saved => (window as unknown as { __kreoda_test: { openIcad(path: string): Promise<unknown> } }).__kreoda_test.openIcad(saved), saved);
    await expect.poll(async () => (await snapOf(window)).bodies.filter(b => b.triangles > 0).length).toBe(2);
    checks.push("desktop-opens-saved-native-document");

    const disabled = await window.evaluate(() => globalThis.window.kreoda.sessionConnectionStatus());
    expect(disabled.listener).toBeNull();
    const host = disabled.interfaces.find(i => i.host !== "127.0.0.1")?.host ?? "127.0.0.1";
    const enabled = await window.evaluate(host => globalThis.window.kreoda.sessionEnable(host, 0), host);
    const url = `ws://${host}:${enabled.listener!.port}`;
    const pairing = await window.evaluate(() => globalThis.window.kreoda.sessionPair());
    const client = new SessionClient(); clients.push(client);
    const paired = await client.pair(url, pairing.token);
    const snapshot = await client.call("snapshot");
    expect((snapshot["features"] as { featureId: string }[]).map(f => f.featureId)).toEqual(["box", "untouched"]);
    expect(snapshot["revision"]).toBe((await snapOf(window)).revision);
    checks.push("production-pairing-and-full-snapshot-on-join");
    const identities = () => window.evaluate(() => {
      const hooks = (window as unknown as { __kreoda_test: { meshIdentity(id: string): { geometryId: string }; viewDir(): unknown } }).__kreoda_test;
      return { box: hooks.meshIdentity("box"), other: hooks.meshIdentity("untouched"), camera: hooks.viewDir() };
    });
    await window.evaluate(() => (window as unknown as { __kreoda_test: { selectFace(id: string, role: string): void } }).__kreoda_test.selectFace("untouched", "box.+Z"));
    await client.call("setSelection", { ids: ["box:box.+Z"], publish: true });
    await expect(window.getByTestId("shared-target-chip")).toContainText("box:box.+Z");
    const shared = () => window.evaluate(() => (window as unknown as {
      __kreoda_test: { snapshot(): { sharedTarget: { ids: string[]; faceGroups: number; edgeSegments: number } } }
    }).__kreoda_test.snapshot().sharedTarget);
    await expect.poll(async () => (await shared()).faceGroups).toBeGreaterThan(0);
    expect((await shared()).ids).toEqual(["box:box.+Z"]);
    expect((await snapOf(window)).selectedIds).toEqual(["untouched:box.+Z"]);
    checks.push("explicit-shared-target-real-desktop-face-highlight-and-chip-local-selection-unchanged");
    const before = await identities();
    const edited = await client.call("command", { commandId: "SetDimension", parameters: { featureId: "box", paramName: "widthMm", valueMm: 25 }, baseRevision: snapshot["revision"] },
      { sessionId: paired.hello["sessionId"], operationId: crypto.randomUUID() });
    await expect(window.getByTestId("shared-target-chip")).toHaveCount(0);
    await expect.poll(async () => (await shared()).ids.length).toBe(0);
    const delta = await client.waitDelta(edited["revision"] as number) as unknown as Record<string, unknown>;
    expect(delta["originClientId"]).toBe(paired.hello["clientId"]);
    expect(delta["changedMeshIds"]).toEqual(["box"]);
    expect(delta).not.toHaveProperty("features");
    await expect.poll(async () => (await snapOf(window)).bodies.find(b => b.id === "box")?.volumeMm3).toBeCloseTo(7500, 4);
    await expect.poll(async () => (await identities()).box.geometryId).not.toBe(before.box.geometryId);
    expect((await identities()).other.geometryId).toBe(before.other.geometryId);
    expect((await identities()).camera).toEqual(before.camera);
    expect((await snapOf(window)).selectedIds).toContain("untouched:box.+Z");
    checks.push("network-edits-existing-parameter", "desktop-applies-incremental-geometry-and-retains-context");

    const undone = await local(8);
    expect(undone["status"]).toBe("ok");
    const undoDelta = await client.waitDelta(undone["revision"] as number) as unknown as Record<string, unknown>;
    expect(undoDelta["originClientId"]).toBe("desktop");
    await expect.poll(async () => (await snapOf(window)).bodies.find(b => b.id === "box")?.volumeMm3).toBeCloseTo(6000, 4);
    const restored = await client.call("snapshot");
    expect((restored["features"] as { featureId: string; volumeMm3: number }[]).find(f => f.featureId === "box")?.volumeMm3).toBeCloseTo(6000, 4);
    expect(restored["revision"]).toBe((await snapOf(window)).revision);
    checks.push("desktop-undo-through-authoritative-ipc", "network-receives-desktop-undo", "matching-native-renderer-network-revisions");
    const metadata = (await client.call("getSessionInfo"))["result"] as { documentRevision: number; connectedClients: { clientId: string }[] };
    expect(metadata.documentRevision).toBe(restored["revision"]);
    expect(metadata.connectedClients.map(c => c.clientId)).toContain("desktop");
    checks.push("generated-session-metadata-with-real-desktop");

    await client.closed();
    const returning = new SessionClient(); clients.push(returning);
    await returning.connectDevice(url, paired.deviceId, paired.credential);
    const reconnected = await returning.call("snapshot");
    expect(reconnected["revision"]).toBe(restored["revision"]);
    expect(reconnected["features"]).toEqual(restored["features"]);
    checks.push("device-credential-reconnect-recovers-state");
    await expect(returning.call("command", { commandId: "SetDimension", parameters: { featureId: "box", paramName: "widthMm", valueMm: "bad" } })).rejects.toMatchObject({ code: "BAD_PARAMS" });
    await expect(returning.call("command", { commandId: "SetDimension", parameters: { featureId: "box", paramName: "widthMm", valueMm: 30 }, baseRevision: 999999 })).rejects.toMatchObject({ code: "NEED_FULL_SNAPSHOT" });
    expect((await returning.call("snapshot"))["revision"]).toBe(restored["revision"]);
    checks.push("invalid-and-stale-commands-preserve-native-state");

    const preview = async (valueMm: number) => {
      const begun = await returning.call("previewBegin", { featureId: "box", paramName: "widthMm", valueMm });
      return (begun["result"] as { previewId: string }).previewId;
    };
    const updatedPreview = await preview(20);
    const update = returning.call("previewUpdate", { previewId: updatedPreview, valueMm: 30 });
    const commitUpdate = returning.call("previewCommit", { previewId: updatedPreview });
    await Promise.all([update, commitUpdate]);
    await expect.poll(async () => (await snapOf(window)).bodies.find(b => b.id === "box")?.volumeMm3).toBeCloseTo(9000, 4);
    expect((await local(8))["status"]).toBe("ok");
    await expect.poll(async () => (await snapOf(window)).bodies.find(b => b.id === "box")?.volumeMm3).toBeCloseTo(6000, 4);
    const committedPreview = await preview(25);
    const commit = returning.call("previewCommit", { previewId: committedPreview });
    const cancel = returning.call("previewCancel", { previewId: committedPreview }).catch(error => ({ errorCode: (error as { code: string }).code }));
    expect((await commit)["ok"]).toBe(true);
    expect(await cancel).toMatchObject({ errorCode: "NOT_FOUND" });
    await expect.poll(async () => (await snapOf(window)).bodies.find(b => b.id === "box")?.volumeMm3).toBeCloseTo(7500, 4);
    expect((await local(8))["status"]).toBe("ok");
    await expect.poll(async () => (await snapOf(window)).bodies.find(b => b.id === "box")?.volumeMm3).toBeCloseTo(6000, 4);
    checks.push("preview-update-commit-burst-uses-latest-native-value", "preview-commit-cancel-burst-rejects-false-cancellation");

    // Also exercise the compiled generated C# client against this Electron
    // host. Pairing credentials travel only through the child environment.
    const csPair = await window.evaluate(() => globalThis.window.kreoda.sessionPair());
    const dll = path.resolve(HERE, "../../../clients/session-dotnet/probes/Kreoda.DeviceProbe/bin/Release/net8.0/Kreoda.DeviceProbe.dll");
    let dotnetPid: number | undefined;
    const cs = await new Promise<{ passed: string[] }>((resolve, reject) => {
      const child = spawn("dotnet", [dll], { windowsHide: true, env: { ...process.env, KREODA_DEVICE_PROBE_URL: url, KREODA_DEVICE_PROBE_PAIR: csPair.token } });
      dotnetPid = child.pid;
      let output = "", errors = "";
      child.stdout.on("data", b => output += String(b)); child.stderr.on("data", b => errors += String(b));
      child.once("error", reject);
      const timer = setTimeout(() => { child.kill(); reject(new Error("compiled client timed out")); }, 30000);
      child.once("exit", code => { clearTimeout(timer); if (code !== 0) reject(new Error(`compiled client failed: ${errors}`)); else resolve(JSON.parse(output.trim()) as { passed: string[] }); });
    });
    expect(cs.passed).toHaveLength(5);
    await expect.poll(async () => (await snapOf(window)).revision).toBe((await returning.call("snapshot"))["revision"]);
    await expect.poll(async () => (await snapOf(window)).bodies.find(b => b.id === "box")?.volumeMm3).toBeCloseTo(6000, 4);
    checks.push("compiled-csharp-pair-edit-undo-metadata-and-reconnect");

    const csMeshPair = await window.evaluate(() => globalThis.window.kreoda.sessionPair());
    const meshDll = path.resolve(HERE, "../../../clients/session-dotnet/probes/Kreoda.SessionProbe/bin/Release/net8.0/Kreoda.SessionProbe.dll");
    let meshDotnetPid: number | undefined;
    const meshProbe = await new Promise<{ passed: string[]; meshHeaders: unknown[]; meshHashes: string[] }>((resolve, reject) => {
      const child = spawn("dotnet", [meshDll], { windowsHide: true, env: {
        ...process.env,
        KREODA_SESSION_PROBE_URL: url,
        KREODA_SESSION_PROBE_MESH: "1",
        KREODA_SESSION_PROBE_PAIR: csMeshPair.token,
        KREODA_SESSION_PROBE_FEATURE: "box",
        KREODA_SESSION_PROBE_UNTOUCHED: "untouched",
      } });
      meshDotnetPid = child.pid;
      let output = "", errors = "";
      child.stdout.on("data", b => output += String(b)); child.stderr.on("data", b => errors += String(b));
      child.once("error", reject);
      const timer = setTimeout(() => { child.kill(); reject(new Error("compiled mesh client timed out")); }, 30000);
      child.once("exit", code => { clearTimeout(timer); if (code !== 0) reject(new Error(`compiled mesh client failed: ${errors}`)); else resolve(JSON.parse(output.trim()) as { passed: string[]; meshHeaders: unknown[]; meshHashes: string[] }); });
    });
    expect(meshProbe.passed).toHaveLength(4);
    expect(meshProbe.meshHeaders).toHaveLength(6);
    expect(meshProbe.meshHashes).toHaveLength(6);
    await expect.poll(async () => (await snapOf(window)).bodies.find(b => b.id === "box")?.volumeMm3).toBeCloseTo(6000, 4);
    checks.push("compiled-csharp-real-flatbuffers-all-lods-edit-undo-reconnect-and-stale-revision");
    const instancePair = await window.evaluate(() => globalThis.window.kreoda.sessionPair());
    const instanceProbe = await new Promise<{ passed: string[] }>((resolve, reject) => {
      const child = spawn("dotnet", [meshDll], { windowsHide: true, env: { ...process.env,
        KREODA_SESSION_PROBE_URL: url, KREODA_SESSION_PROBE_PAIR: instancePair.token,
        KREODA_SESSION_PROBE_FEATURE: "box", KREODA_SESSION_PROBE_INSTANCE_MESH: "1" } });
      let output = "", errors = "";
      child.stdout.on("data", b => output += String(b)); child.stderr.on("data", b => errors += String(b));
      child.once("error", reject);
      const timer = setTimeout(() => { child.kill(); reject(new Error("compiled instance client timed out")); }, 30000);
      child.once("exit", code => { clearTimeout(timer); if (code !== 0) reject(new Error(`compiled instance client failed: ${errors}`));
        else resolve(JSON.parse(output.trim()) as { passed: string[] }); });
    });
    expect(instanceProbe.passed).toHaveLength(5);
    await expect.poll(async () => (await snapOf(window)).bodies.find(b => b.id === "box")?.volumeMm3).toBeCloseTo(6000, 4);
    checks.push("compiled-csharp-older-source-instance-placement-edit-undo-and-reconnect");
    await window.evaluate(id => globalThis.window.kreoda.sessionRevoke(id), paired.deviceId);
    await expect.poll(() => returning.call("getSessionInfo").then(() => false, () => true)).toBe(true);
    const revoked = new SessionClient(); clients.push(revoked);
    await expect(revoked.connectDevice(url, paired.deviceId, paired.credential)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    checks.push("production-revocation-closes-and-rejects-device");
    const native = await window.evaluate(() => globalThis.window.kreoda.coreInfo());
    const visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.isVisible()));
    if (process.env["KREODA_LOCAL_CORE_PROBE"]) expect(visible).toBe(false);
    const runtime = test.info().outputPath("session-acceptance-runtime.json");
    writeFileSync(runtime, JSON.stringify({ checks, dotnetChecks: cs.passed, meshProbe, instanceProbe, kernel: kernel["occtVersion"],
      mainPid: app.process().pid, corePid: native.pid, dotnetPid, meshDotnetPid, visibleWindows: visible,
      finalRevision: (await snapOf(window)).revision, inputActions: 0, host,
      boundary: "Actual Electron renderer/main, OCCT and paired WebSocket plus compiled C# clients on the same host; no Unity or remote hardware." }));
    await test.info().attach("session-acceptance-runtime", { contentType: "application/json", path: runtime });
  } finally {
    for (const client of clients) client.closeRaw();
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
  const { app, window } = await boot(env);
  const client = new SessionClient();
  try {
    await client.connect(TOKEN, PORT);

    const txnId = `txn-${crypto.randomUUID()}`;
    await client.call("txnBegin", { transactionId: txnId });
    const boxA = `box-${crypto.randomUUID()}`;
    const boxB = `box-${crypto.randomUUID()}`;
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
      .poll(async () => (await snapOf(window)).bodies.length, {
        timeout: 30000,
      })
      .toBe(2);
    // Exactly ONE Undo removes both: the transaction committed one delta.
    await window.locator('button[title^="Undo"]').click();
    await expect
      .poll(async () => (await snapOf(window)).bodies.length, {
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
  const { app, window } = await boot(env);
  const client = new SessionClient();
  try {
    // A real box through the desktop path (exact B-Rep + tessellation).
    await runBar(window, "box 100 60 10");
    await expect
      .poll(async () => (await snapOf(window)).bodies.length, {
        timeout: 30000,
      })
      .toBe(1);
    const boxId = (await snapOf(window)).bodies[0]!.id;

    await client.connect(TOKEN, PORT);
    const shared = await client.call("snapshot", {}) as { features: { featureId: string }[]; revision: number };
    expect(shared.features.map(feature => feature.featureId)).toEqual([boxId]);
    expect(shared.revision).toBe((await snapOf(window)).revision);
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
        const cur = await snapOf(window);
        return cur.bodies.find((b) => b.id === boxId)!.paramsMm[0];
      }, { timeout: 30000 })
      .toBeCloseTo(200, 6);
    await window.locator('button[title^="Undo"]').click();
    await expect
      .poll(async () => {
        const cur = await snapOf(window);
        return cur.bodies.find((b) => b.id === boxId)!.paramsMm[0];
      }, { timeout: 20000 })
      .toBeCloseTo(100, 6);

    const valid = (await q("validateDocument", {})) as {
      valid: boolean;
      scope: string;
    };
    expect(valid.valid).toBe(true);
    expect(valid.scope).toBe("kernel");
  } finally {
    client.closeRaw();
    await app.close();
  }
});


