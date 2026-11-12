import { test, expect } from "@playwright/test";
import { createServer } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot, openProperties, runBar, snapOf } from "./helpers";
import { SessionClient } from "./ws-test-client";

test("real OCCT interference is shared read-only and remains correct after save/open and Undo", async ({}, testInfo) => {
  const socket = createServer();
  await new Promise<void>(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "kreoda-interference-"));
  const file = path.join(profile, "parts.icad");
  const token = `interference-${process.pid}`;
  const { app, window } = await boot({ KREODA_BACKGROUND_TEST: "1", KREODA_SESSION_PORT: String(port),
    KREODA_SESSION_TOKEN: token }, [`--user-data-dir=${profile}`]);
  const peer = new SessionClient();
  try {
    await runBar(window, "box 10 10 10");
    const source = (await snapOf(window)).bodies[0]!.id;
    const part = await window.evaluate(id => (window as unknown as { __kreoda_test: {
      assemblyMateE2E: { instance: (id: string, x: number, y: number, z: number) => Promise<string> }
    } }).__kreoda_test.assemblyMateE2E.instance(id, 5, 0, 0), source);
    const before = await snapOf(window);
    await peer.connect(token, port);
    const analysis = (await peer.call("measureInterferences", { featureIds: [source, part] }))["result"] as {
      basis: string; componentCount: number; interferences: { featureA: string; featureB: string; volumeMm3: number; centroidMm: number[] }[];
    };
    expect(analysis.basis).toBe("occt-common-volume");
    expect(analysis.componentCount).toBe(2);
    expect(analysis.interferences).toHaveLength(1);
    expect(analysis.interferences[0]).toMatchObject({ featureA: source, featureB: part });
    expect(analysis.interferences[0]!.volumeMm3).toBeCloseTo(500, 6);
    [7.5,5,5].forEach((value,index) => expect(analysis.interferences[0]!.centroidMm[index]).toBeCloseTo(value,6));

    const panel = window.getByTestId("interference-analysis-panel");
    if (!await panel.isVisible()) await openProperties(window);
    await panel.scrollIntoViewIfNeeded();
    await panel.getByRole("button", { name: "Controlla interferenze" }).click();
    await expect(panel.getByText("500 mm³", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Seleziona componenti" }).click();
    expect((await snapOf(window)).selectedIds.sort()).toEqual([source, part].sort());
    await expect(window.getByTestId("properties-drawer").getByText(/Nothing selected/)).toHaveCount(0);
    const after = await snapOf(window);
    expect(after.revision).toBe(before.revision);
    expect(after.bodies).toEqual(before.bodies);
    await panel.evaluate(element => element.scrollIntoView({ block: "start", behavior: "auto" }));
    const image = await app.evaluate(async ({ BrowserWindow }) => {
      const target = BrowserWindow.getAllWindows()[0]!;
      if (target.isVisible()) throw Error("Interference test must remain hidden");
      await target.capturePage(undefined, { stayHidden: true });
      const image = await target.capturePage(undefined, { stayHidden: true });
      if (image.isEmpty() || target.isVisible()) throw Error("Hidden UI capture failed");
      return image.toPNG().toString("base64");
    });
    fs.writeFileSync(testInfo.outputPath("interference-ui.png"), Buffer.from(image, "base64"));

    peer.closeRaw();
    await window.evaluate(() => (window as unknown as { __kreoda_test: { configurationE2E: { undo: () => Promise<void> } } }).__kreoda_test.configurationE2E.undo());
    const undone = await snapOf(window);
    expect(undone.bodies.some(body => body.id === part)).toBe(false);
    expect(undone.bodies.some(body => body.id === source)).toBe(true);
    await panel.getByRole("button", { name: "Controlla interferenze" }).click();
    await expect(panel.getByText("Nessuna interferenza volumetrica.")).toBeVisible();
    await window.evaluate(() => (window as unknown as { __kreoda_test: { configurationE2E: { redo: () => Promise<void> } } }).__kreoda_test.configurationE2E.redo());
    await window.evaluate(file => (window as unknown as { __kreoda_test: { saveIcad: (path: string) => Promise<unknown> } }).__kreoda_test.saveIcad(file), file);
    await window.evaluate(file => (window as unknown as { __kreoda_test: { openIcad: (path: string) => Promise<unknown> } }).__kreoda_test.openIcad(file), file);
    await expect(panel.getByText("500 mm³", { exact: true })).toHaveCount(0);
    await panel.getByRole("button", { name: "Controlla interferenze" }).click();
    await expect(panel.getByText("500 mm³", { exact: true })).toBeVisible();
  } finally {
    peer.closeRaw();
    await app.close();
    const root = path.resolve(os.tmpdir()) + path.sep;
    if (!path.resolve(profile).startsWith(root) || !path.basename(profile).startsWith("kreoda-interference-"))
      throw Error("Unexpected interference test cleanup path");
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
