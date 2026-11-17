import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAIN, runBar, snapOf } from "./helpers";

test("perf scale: 100-body commits, save/open and STEP export", async () => {
  test.slow();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "kreoda-perf-scale-"));
  const icad = path.join(profile, "scale.icad");
  const step = path.join(profile, "scale.step");
  const app = await electron.launch({
    executablePath: createRequire(import.meta.url)("electron") as string,
    args: [MAIN, "--no-sandbox", "--lang=en-US", `--user-data-dir=${profile}`],
  });
  try {
    const window = await app.firstWindow({ timeout: 30000 });
    await expect(window.getByTestId("home-screen")).toBeVisible({ timeout: 20000 });
    await window.getByTestId("home-new-project").click();
    await expect(window.getByTestId("workspace-chrome")).toBeVisible({ timeout: 20000 });
    await expect(window.getByText(/core 0\.1\.0/)).toBeVisible({ timeout: 20000 });
    await runBar(window, "box 10 10 10");
    await expect.poll(async () => (await snapOf(window)).bodies.length, { timeout: 30000 }).toBe(1);
    const perBox: number[] = [];
    for (let i = 0; i < 99; i++) {
      const start = Date.now();
      await runBar(window, "box 10 10 10");
      perBox.push(Date.now() - start);
    }
    await expect.poll(async () => (await snapOf(window)).bodies.length, { timeout: 120000 }).toBe(100);
    const snapshot = await snapOf(window);
    const triangles = snapshot.bodies.reduce((sum, body) => sum + body.triangles, 0);
    const average = perBox.reduce((sum, value) => sum + value, 0) / perBox.length;
    const max = Math.max(...perBox);

    const saveStart = Date.now();
    await window.evaluate(file => (window as unknown as {
      __kreoda_test: { saveIcad: (p: string) => Promise<unknown> };
    }).__kreoda_test.saveIcad(file), icad);
    const saveMs = Date.now() - saveStart;
    const icadBytes = fs.statSync(icad).size;

    const openStart = Date.now();
    const reopened = (await window.evaluate(file => (window as unknown as {
      __kreoda_test: { openIcad: (p: string) => Promise<unknown> };
    }).__kreoda_test.openIcad(file), icad)) as { bodies: unknown[] };
    const openMs = Date.now() - openStart;
    expect(reopened.bodies).toHaveLength(100);

    const stepStart = Date.now();
    await window.evaluate(file => (window as unknown as {
      __kreoda_test: { saveIcad: (p: string) => Promise<unknown> };
    }).__kreoda_test.saveIcad(file), step);
    const stepMs = Date.now() - stepStart;
    const stepBytes = fs.statSync(step).size;

    console.log(`PHASE10_PERF_SCALE ${JSON.stringify({
      bodies: 100,
      triangles,
      commitAvgMs: Number(average.toFixed(0)),
      commitMaxMs: max,
      saveIcadMs: saveMs,
      saveIcadBytes: icadBytes,
      reopenIcadMs: openMs,
      stepExportMs: stepMs,
      stepExportBytes: stepBytes,
    })}`);
  } finally {
    await app.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
