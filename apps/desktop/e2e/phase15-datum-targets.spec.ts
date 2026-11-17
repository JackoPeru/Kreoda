import { test, expect, _electron as electron } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot, openMore, snapOf } from "./helpers";
import { SessionClient } from "./ws-test-client";

test.use({ trace: "off" });

function removeProfile(profile: string): void {
  const root = realpathSync(os.tmpdir());
  const target = realpathSync(profile);
  const relative = path.relative(root, target);
  if (!relative || path.isAbsolute(relative) || path.dirname(relative) !== "." ||
      !path.basename(target).startsWith("kreoda-phase15-datum-targets-")) {
    throw new Error("Refusing to remove profile outside its isolated temp directory");
  }
  rmSync(target, { recursive: true, force: true });
}

test("actual native datum target binds sketch support and clears after Undo", async () => {
  test.setTimeout(120000);
  const profile = mkdtempSync(path.join(os.tmpdir(), "kreoda-phase15-datum-targets-"));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  const clients: SessionClient[] = [];
  try {
    const launched = await boot({
      ...process.env,
      KREODA_BACKGROUND_TEST: "1",
      KREODA_SESSION_PORT: "",
      KREODA_SESSION_TOKEN: "",
      KREODA_RECOVERY_DIR: profile,
    }, ["--user-data-dir=" + profile]);
    app = launched.app;
    const window = launched.window;
    await expect.poll(() => window.evaluate(() => globalThis.window.kreoda.coreInfo().then(info => info.running))).toBe(true);

    await openMore(window);
    await window.getByTestId("reference-geometry-button").click();
    const panel = window.getByTestId("reference-geometry-panel");
    await panel.getByLabel("Construction method").selectOption("offset");
    await panel.getByLabel("Offset (mm)").fill("24");
    await panel.getByRole("button", { name: "Create reference" }).click();
    await expect.poll(async () => (await snapOf(window)).datums ?? []).toHaveLength(1);
    const planeId = (await snapOf(window)).datums![0]!.featureId;
    expect((await snapOf(window)).datums![0]!.resolved).toMatchObject({ originMm: [0, 0, 24] });

    await panel.getByLabel("Reference type").selectOption("axis");
    await panel.getByLabel("Construction method").selectOption("planeNormal");
    await panel.getByRole("button", { name: "Create reference" }).click();
    await expect.poll(async () => (await snapOf(window)).datums?.filter(datum => datum.kind === "DatumAxis") ?? []).toHaveLength(1);
    const axisId = (await snapOf(window)).datums!.find(datum => datum.kind === "DatumAxis")!.featureId;

    const listener = await window.evaluate(() => globalThis.window.kreoda.sessionEnable("127.0.0.1", 0));
    expect(listener.listener?.port).toBeGreaterThan(0);
    const pairing = await window.evaluate(() => globalThis.window.kreoda.sessionPair());
    const client = new SessionClient();
    clients.push(client);
    const { hello } = await client.pair("ws://127.0.0.1:" + listener.listener!.port + "/", pairing.token);
    expect(((await client.call("getCapabilities")).result as { queries: string[] }).queries).toContain("listCommands");

    const validation = (await client.call("validateReferences", { ids: [axisId] })).result as {
      valid: boolean; checks: { id: string; kind?: string; owner?: string; ownerBody?: string }[];
    };
    expect(validation).toMatchObject({ valid: true, checks: [{ id: axisId, kind: "datumAxis", owner: axisId }] });
    expect(validation.checks[0]).not.toHaveProperty("ownerBody");
    const axisSnapshot = await client.call("snapshot");
    const revision = axisSnapshot["revision"] as number;
    const axisContext = (await client.call("listCommands", { selectionIds: [axisId], expectedRevision: revision })).result as {
      commands: { id: string; boundParameters: Record<string, unknown> }[];
    };
    expect(axisContext.commands.find(command => command.id === "CreateSketch")?.boundParameters).toEqual({});

    let wrongKindFailure: { code?: string; message?: string } | undefined;
    try {
      await client.call("command", { commandId: "CreateSketch", parameters: { supportRef: axisId, model: {} }, baseRevision: revision },
        { sessionId: hello["sessionId"], operationId: randomUUID() });
    } catch (error) {
      const failure = error as Error & { code?: string };
      wrongKindFailure = { code: failure.code, message: failure.message };
    }
    expect(wrongKindFailure).toMatchObject({ code: "SKETCH_FAILED" });
    expect(wrongKindFailure?.message).toContain("sketch requires a valid DatumPlane");

    const missing = (await client.call("listCommands", { selectionIds: ["missing-native-datum"], expectedRevision: revision })).result as {
      contextValid: boolean; commands: { id: string; boundParameters: Record<string, unknown> }[];
    };
    expect(missing.contextValid).toBe(false);
    expect(missing.commands.find(command => command.id === "CreateSketch")).toMatchObject({ available: false, boundParameters: {} });
    await expect(client.call("listCommands", { selectionIds: [planeId], expectedRevision: revision - 1 }))
      .rejects.toMatchObject({ code: "NEED_FULL_SNAPSHOT" });

    await window.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await snapOf(window)).datums?.map(datum => datum.featureId) ?? []).toEqual([planeId]);
    const current = await client.call("snapshot");
    let currentRevision = current["revision"] as number;
    const planeContext = (await client.call("listCommands", { selectionIds: [planeId], expectedRevision: currentRevision })).result as {
      contextValid: boolean; commands: { id: string; available: boolean; boundParameters: Record<string, unknown> }[];
    };
    expect(planeContext.contextValid).toBe(true);
    const sketchCommand = planeContext.commands.find(command => command.id === "CreateSketch")!;
    expect(sketchCommand).toMatchObject({ available: true, boundParameters: { supportRef: planeId } });

    await client.call("command", {
      commandId: "CreateSketch",
      parameters: { ...sketchCommand.boundParameters, model: {} },
      baseRevision: currentRevision,
    }, { sessionId: hello["sessionId"], operationId: randomUUID() });
    const supportedSketch = async () => (await snapOf(window)).sketches.find(sketch => sketch.supportRef === planeId);
    await expect.poll(supportedSketch).toMatchObject({
      supportRef: planeId,
      plane: { origin: [0, 0, 24], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
    });
    const sessionSnapshot = await client.call("snapshot");
    expect((sessionSnapshot["sketches"] as { supportRef?: string; plane?: unknown }[])
      .find(sketch => sketch.supportRef === planeId)).toMatchObject({
      supportRef: planeId,
      plane: { origin: [0, 0, 24], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
    });
    await window.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await snapOf(window)).sketches).toHaveLength(0);
    await expect.poll(async () => (await snapOf(window)).datums?.map(datum => datum.featureId) ?? []).toEqual([planeId]);
    currentRevision = (await client.call("snapshot"))["revision"] as number;

    await client.call("setSelection", { ids: [planeId], publish: true });
    await expect(window.getByTestId("shared-target-chip")).toContainText(planeId);
    const diagnostics = () => window.evaluate(() => (window as unknown as {
      __kreoda_test: { snapshot(): { sharedTarget: { ids: string[]; faceGroups: number; edgeSegments: number }; selectedIds: string[] } };
    }).__kreoda_test.snapshot());
    await expect.poll(async () => (await diagnostics()).sharedTarget.ids).toEqual([planeId]);
    expect((await diagnostics()).sharedTarget).toMatchObject({ faceGroups: 0, edgeSegments: 0 });
    expect((await diagnostics()).selectedIds).not.toContain(planeId);
    expect((await snapOf(window)).bodies).toHaveLength(0);

    await window.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await snapOf(window)).datums ?? []).toHaveLength(0);
    await expect.poll(async () => (await diagnostics()).sharedTarget.ids).toEqual([]);
    await expect(window.getByTestId("shared-target-chip")).toHaveCount(0);
  } finally {
    for (const client of clients) client.closeRaw();
    await app?.close().catch(() => {});
    removeProfile(profile);
  }
});
