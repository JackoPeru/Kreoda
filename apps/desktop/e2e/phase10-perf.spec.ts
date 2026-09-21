// Phase 10 performance baseline (§10.7): end-to-end wall-clock numbers on
// the real Electron + OCCT sidecar path. These are RECORDED baselines, not
// gates — no time thresholds asserted (only functional completion).

import { test, expect, _electron as electron, type Page } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { MAIN, type Snapshot } from "./helpers";

const ICAD = path.join(os.tmpdir(), "kreoda-phase10-perf.icad");
const STEP = path.join(os.tmpdir(), "kreoda-phase10-perf.step");

function snapOf(window: Page): Promise<Snapshot> {
  return window.evaluate(() =>
    (
      window as unknown as {
        __kreoda_test: { snapshot: () => Snapshot };
      }
    ).__kreoda_test.snapshot(),
  ) as Promise<Snapshot>;
}

async function runBar(window: Page, text: string): Promise<number> {
  const t0 = Date.now();
  const input = window.getByTestId("command-input");
  await input.fill(text);
  await input.press("Enter");
  const preview = window.getByTestId("plan-preview");
  await expect(preview).toBeVisible({ timeout: 5000 });
  await preview.getByRole("button", { name: /Run 1 step/ }).click();
  await expect(preview).toBeHidden({ timeout: 120000 });
  // m15: same failure-text assertion as the golden helper — a failed commit
  // must not record a timing as if it succeeded.
  const failures = await window
    .getByText(/Stopped after|planning failed|execution failed/)
    .allTextContents();
  expect(
    failures.length === 0 ? "" : `plan failed: ${failures.join(" | ")}`,
  ).toBe("");
  return Date.now() - t0;
}

test("perf baseline: commit/save/reopen/export timings + 20-body stress", async () => {
  test.slow();
  const tBoot0 = Date.now();
  const app = await electron.launch({ args: [MAIN, "--no-sandbox"] });
  try {
    const window = await app.firstWindow({ timeout: 30000 });
    await window.waitForLoadState("domcontentloaded");
    await expect(window.getByText(/core 0\.1\.0/)).toBeVisible({
      timeout: 20000,
    });
    const bootMs = Date.now() - tBoot0;

    // Single-feature commits through the real path.
    const boxMs = await runBar(window, "box 100 60 10");
    await expect
      .poll(async () => ((await snapOf(window)) as Snapshot).bodies.length, {
        timeout: 30000,
      })
      .toBe(1);
    const snap1 = (await snapOf(window)) as Snapshot;
    const tri1 = snap1.bodies.reduce((a, b) => a + b.triangles, 0);

    // Multi-body stress: 20 small boxes (feature-count scaling).
    const perBox: number[] = [];
    for (let i = 0; i < 20; i++) {
      perBox.push(await runBar(window, "box 10 10 10"));
    }
    await expect
      .poll(async () => ((await snapOf(window)) as Snapshot).bodies.length, {
        timeout: 120000,
      })
      .toBe(21);
    const snapN = (await snapOf(window)) as Snapshot;
    const triN = snapN.bodies.reduce((a, b) => a + b.triangles, 0);
    const avgBox = perBox.reduce((a, b) => a + b, 0) / perBox.length;
    const maxBox = Math.max(...perBox);

    // Save / reopen / STEP export round-trip timings.
    const tSave0 = Date.now();
    await window.evaluate(
      ({ icad }) =>
        (
          window as unknown as {
            __kreoda_test: { saveIcad: (p: string) => Promise<Snapshot> };
          }
        ).__kreoda_test.saveIcad(icad),
      { icad: ICAD },
    );
    const saveMs = Date.now() - tSave0;
    const icadBytes = fs.statSync(ICAD).size;
    const tOpen0 = Date.now();
    const reopened = (await window.evaluate(
      ({ icad }) =>
        (
          window as unknown as {
            __kreoda_test: { openIcad: (p: string) => Promise<Snapshot> };
          }
        ).__kreoda_test.openIcad(icad),
      { icad: ICAD },
    )) as Snapshot;
    const openMs = Date.now() - tOpen0;
    expect(reopened.bodies).toHaveLength(21);
    const tStep0 = Date.now();
    await window.evaluate(
      ({ step }) =>
        (
          window as unknown as {
            __kreoda_test: { saveIcad: (p: string) => Promise<Snapshot> };
          }
        ).__kreoda_test.saveIcad(step),
      { step: STEP },
    );
    const stepMs = Date.now() - tStep0;
    const stepBytes = fs.statSync(STEP).size;

    const rows: [string, string][] = [
      ["boot_to_interactive_ms", String(bootMs)],
      ["box_commit_ms", String(boxMs)],
      ["box_triangles", String(tri1)],
      ["21body_commit_avg_ms", avgBox.toFixed(0)],
      ["21body_commit_max_ms", String(maxBox)],
      ["21body_triangles", String(triN)],
      ["save_icad_ms", String(saveMs)],
      ["save_icad_bytes", String(icadBytes)],
      ["reopen_icad_ms", String(openMs)],
      ["step_export_ms", String(stepMs)],
      ["step_export_bytes", String(stepBytes)],
    ];
    // eslint-disable-next-line no-console
    console.log(
      `PHASE10_PERF ${JSON.stringify(Object.fromEntries(rows))}`,
    );
  } finally {
    await app.close();
  }
});
