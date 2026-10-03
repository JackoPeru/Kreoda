import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAIN, snapOf } from "./helpers";
import { SessionClient } from "./ws-test-client";
import type { SessionIncrementalDelta } from "@kreoda/protocol";

test("incremental Desktop applies remote edits, keeps other geometry, and recovers a lost event without GUI input", async () => {
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, "127.0.0.1", resolve));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const profile = mkdtempSync(path.join(os.tmpdir(), "kreoda-incremental-"));
  const app = await electron.launch({
    executablePath: createRequire(import.meta.url)("electron") as string,
    args: [MAIN, "--no-sandbox", "--lang=en-US", `--user-data-dir=${profile}`],
    env: { ...process.env, KREODA_SESSION_PORT: String(port), KREODA_SESSION_TOKEN: "isolated-incremental-test", KREODA_RECOVERY_DIR: profile },
  });
  const client = new SessionClient();
  try {
    const window = await app.firstWindow();
    await expect.poll(() => window.evaluate(() => !!(window as unknown as { __kreoda_test?: unknown }).__kreoda_test)).toBe(true);
    await expect.poll(() => window.evaluate(() => globalThis.window.kreoda.coreInfo().then(info => info.running))).toBe(true);
    await window.evaluate(() => (window as unknown as { __kreoda_test: { openWorkspace: () => void } }).__kreoda_test.openWorkspace());
    await expect(window.getByTestId("workspace-chrome")).toBeVisible();
    await client.connect("isolated-incremental-test", port, undefined, ["incremental-deltas"]);
    const kernel = await client.call("invoke", { type: 1 });
    expect(kernel["occtVersion"]).toBe("8.0.1-native");
    await client.call("invoke", { type: 2 });
    const a = `box-${crypto.randomUUID()}`, b = `box-${crypto.randomUUID()}`;
    for (const featureId of [a, b])
      await client.call("invoke", { type: 3, fields: { featureId, widthMm: 100, heightMm: 60, depthMm: 10 } });
    await expect.poll(async () => (await snapOf(window)).bodies.filter(body => body.triangles > 0).length).toBe(2);
    const identities = () => window.evaluate(([a, b]) => {
      const hooks = (window as unknown as { __kreoda_test: { meshIdentity: (id: string) => unknown; viewDir: () => unknown } }).__kreoda_test;
      return { a: hooks.meshIdentity(a!), b: hooks.meshIdentity(b!), camera: hooks.viewDir() };
    }, [a, b]) as Promise<{ a: { geometryId: string }; b: { geometryId: string }; camera: unknown }>;
    await window.evaluate(b => (window as unknown as { __kreoda_test: { selectFace: (id: string, role: string) => void } }).__kreoda_test.selectFace(b, "box.+Z"), b);
    const before = await identities();
    const base = (await snapOf(window)).revision;
    const edited = await client.call("invoke", { type: 6, baseRevision: base, fields: { featureId: a, paramName: "widthMm", valueMm: 120 } });
    const event = await client.waitDelta(edited["revision"] as number) as unknown as SessionIncrementalDelta;
    for (const field of ["features", "sketches", "bodies", "tips"]) expect(Object.hasOwn(event, field)).toBe(false);
    expect(event.changedMeshIds).toContain(a);
    expect(event.changedMeshIds).not.toContain(b);
    await expect.poll(async () => (await snapOf(window)).bodies.find(body => body.id === a)?.volumeMm3).toBeCloseTo(72000, 3);
    await expect.poll(async () => (await identities()).a.geometryId).not.toBe(before.a.geometryId);
    const after = await identities();
    expect(after.b.geometryId).toBe(before.b.geometryId);
    expect(after.camera).toEqual(before.camera);
    expect((await snapOf(window)).selectedIds).toContain(`${b}:box.+Z`);

    // Fault at the delivery boundary: drop exactly one real main→renderer
    // event, then let the next real event expose the revision gap.
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]!.webContents;
      const send = contents.send.bind(contents);
      contents.send = (channel, ...args) => {
        if (channel === "kreoda:session-delta") { contents.send = send; return; }
        send(channel, ...args);
      };
    });
    await client.call("invoke", { type: 6, fields: { featureId: a, paramName: "widthMm", valueMm: 130 } });
    const recovered = await client.call("invoke", { type: 6, fields: { featureId: a, paramName: "widthMm", valueMm: 150 } });
    await expect.poll(async () => (await snapOf(window)).revision).toBe(recovered["revision"]);
    await expect.poll(async () => (await snapOf(window)).bodies.find(body => body.id === a)?.volumeMm3).toBeCloseTo(90000, 3);
    const authoritative = await window.evaluate(() => globalThis.window.kreoda.sessionSnapshot());
    expect(authoritative.revision).toBe(recovered["revision"]);
    expect(authoritative.features.find(feature => feature["featureId"] === a)?.["volumeMm3"]).toBeCloseTo(90000, 3);
    expect((await snapOf(window)).selectedIds).toContain(`${b}:box.+Z`);
    expect((await identities()).camera).toEqual(before.camera);
    const native = await window.evaluate(() => globalThis.window.kreoda.coreInfo());
    const visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isVisible()));
    if (process.env["KREODA_LOCAL_CORE_PROBE"]) expect(visible).toBe(false);
    const runtimePath = test.info().outputPath("session-runtime.json");
    writeFileSync(runtimePath, JSON.stringify({
      kernel: kernel["occtVersion"], mainPid: app.process().pid, corePid: native.pid, visibleWindows: visible,
      changedGeometryReplaced: after.a.geometryId !== before.a.geometryId,
      untouchedGeometryPreserved: after.b.geometryId === before.b.geometryId,
      cameraPreserved: true, selectionPreserved: true, lostEventRecovered: true,
      baseRevision: base, editedRevision: edited["revision"], recoveredRevision: recovered["revision"],
      finalVolumeMm3: 90000, inputActions: 0,
    }));
    await test.info().attach("session-runtime", { contentType: "application/json", path: runtimePath });
  } finally {
    client.closeRaw();
    await app.close();
  }
});
