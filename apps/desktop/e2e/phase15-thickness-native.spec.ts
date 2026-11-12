import { test, expect } from "@playwright/test";
import { createServer } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot, openProperties, runBar, snapOf } from "./helpers";
import { SessionClient } from "./ws-test-client";

test.use({ trace: "off" });
test("native sampled thickness is shared read-only and refreshes after edit, Undo and ICAD reopen", async ({}, info) => {
  test.setTimeout(120000);
  const listener = createServer();await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as { port: number }).port;await new Promise<void>(resolve => listener.close(() => resolve()));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "kreoda-thickness-"));
  const file = path.join(profile, "thickness.icad");
  const peer = new SessionClient();let app: Awaited<ReturnType<typeof boot>>["app"] | undefined;
  try {
    const launched = await boot({ KREODA_BACKGROUND_TEST: "1", KREODA_SESSION_PORT: String(port), KREODA_SESSION_TOKEN: "thickness-test" }, [`--user-data-dir=${profile}`]);
    app = launched.app;const window = launched.window;
    await runBar(window, "box 20 30 10");
    const feature = (await snapOf(window)).bodies[0]!.id;
    const select = () => window.evaluate(id => (window as unknown as { __kreoda_test: { selectMany: (ids: string[]) => void } }).__kreoda_test.selectMany([id]), feature);
    await select();const before = await snapOf(window);
    await peer.connect("thickness-test", port);
    const measured = (await peer.call("measureMinimumThickness", { featureId: feature, maxSamples: 128 }))["result"] as {
      basis: string; isGlobalMinimum: boolean; minimumThicknessMm: number; sampledFaces: number; totalFaces: number;
      witness: { pointAMm: number[]; pointBMm: number[] };
    };
    expect(measured).toMatchObject({ basis: "occt-sampled-normal-rays", isGlobalMinimum: false, sampledFaces: 6, totalFaces: 6 });
    expect(measured.minimumThicknessMm).toBeCloseTo(10, 6);
    expect(Math.hypot(...measured.witness.pointAMm.map((v, i) => v - measured.witness.pointBMm[i]!))).toBeCloseTo(10, 6);
    await openProperties(window);
    const panel = window.getByTestId("thickness-analysis-panel");await panel.scrollIntoViewIfNeeded();
    await panel.getByRole("button", { name: "Calcola spessore" }).click();
    await expect(panel.getByText("10 mm", { exact: true })).toBeVisible();
    await expect(panel.getByText(/Analisi campionata/)).toBeVisible();
    const after = await snapOf(window);expect(after.revision).toBe(before.revision);expect(after.bodies).toEqual(before.bodies);
    const image = await app.evaluate(async ({ BrowserWindow }) => {
      const target = BrowserWindow.getAllWindows()[0]!;
      if (target.isVisible()) throw Error("Thickness capture must remain hidden");
      await target.capturePage(undefined, { stayHidden: true });
      return (await target.capturePage(undefined, { stayHidden: true })).toPNG().toString("base64");
    });
    fs.writeFileSync(info.outputPath("thickness-ui.png"), Buffer.from(image, "base64"));
    fs.writeFileSync(info.outputPath("thickness-result.json"), JSON.stringify({ result: { ...measured, featureId: feature } }));
    peer.closeRaw();
    await window.evaluate(id => (window as unknown as { __kreoda_test: { setParam: (id: string, name: string, value: number) => Promise<void> } }).__kreoda_test.setParam(id, "heightMm", 4), feature);
    await expect(panel.getByText("10 mm", { exact: true })).toHaveCount(0);
    await panel.getByRole("button", { name: "Calcola spessore" }).click();
    await expect(panel.getByText("4 mm", { exact: true })).toBeVisible();
    await window.evaluate(() => (window as unknown as { __kreoda_test: { configurationE2E: { undo: () => Promise<void> } } }).__kreoda_test.configurationE2E.undo());
    await select();await panel.getByRole("button", { name: "Calcola spessore" }).click();
    await expect(panel.getByText("10 mm", { exact: true })).toBeVisible();
    await window.evaluate(() => (window as unknown as { __kreoda_test: { configurationE2E: { redo: () => Promise<void> } } }).__kreoda_test.configurationE2E.redo());
    await window.evaluate(file => (window as unknown as { __kreoda_test: { saveIcad: (path: string) => Promise<void> } }).__kreoda_test.saveIcad(file), file);
    await window.evaluate(file => (window as unknown as { __kreoda_test: { openIcad: (path: string) => Promise<void> } }).__kreoda_test.openIcad(file), file);
    await expect(panel.getByText("10 mm", { exact: true })).toHaveCount(0);
    await select();await panel.getByRole("button", { name: "Calcola spessore" }).click();
    await expect(panel.getByText("4 mm", { exact: true })).toBeVisible();
    fs.writeFileSync(info.outputPath("thickness-proof.json"), JSON.stringify({ measured, initialRevision: before.revision,
      readOnlyRevision: after.revision, editedMm: 4, undoMm: 10, reopenedMm: 4 }, null, 2));
  } finally {
    peer.closeRaw();await app?.close();
    const absolute = fs.realpathSync(profile), temporary = fs.realpathSync(os.tmpdir());
    if (path.dirname(absolute).toLowerCase() !== temporary.toLowerCase() || !path.basename(absolute).startsWith("kreoda-thickness-"))
      throw Error("Unexpected thickness fixture cleanup path");
    fs.rmSync(absolute, { recursive: true, force: true });
  }
});
