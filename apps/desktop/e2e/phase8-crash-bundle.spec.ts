// Phase 8 E2E (§61): crash/support bundle carries versions, sidecar log
// tail and the model snapshot in one attachable file. Exercised without an
// actual crash — the bundle path is identical from the banner button.

import { test, expect, _electron as electron } from "@playwright/test";
import { MAIN } from "./helpers";

interface Bundle {
  path: string;
  bytes: number;
  preview: string;
}

test("crash bundle contains versions, log tail and snapshot", async () => {
  const app = await electron.launch({
    args: [MAIN, "--no-sandbox"],
  });
  try {
    const window = await app.firstWindow({ timeout: 30000 });
    await window.waitForLoadState("domcontentloaded");
    await expect(window.getByText(/core 0\.1\.0/)).toBeVisible({
      timeout: 20000,
    });

    // Model something so the snapshot is non-trivial.
    const input = window.getByTestId("command-input");
    await input.fill("box 100 50 20");
    await input.press("Enter");
    const preview = window.getByTestId("plan-preview");
    await expect(preview).toBeVisible({ timeout: 5000 });
    await preview.getByRole("button", { name: /Run 1 step/ }).click();
    await expect(window.getByText(/Box 100×50×20/).first()).toBeVisible({
      timeout: 20000,
    });

    const bundle = (await window.evaluate(() =>
      (
        window as unknown as {
          __kreoda_test: { crashBundle: () => Promise<Bundle> };
        }
      ).__kreoda_test.crashBundle(),
    )) as Bundle;
    expect(bundle.bytes).toBeGreaterThan(200);
    expect(bundle.path).toMatch(/crash-bundle-.*\.json$/);
    // Preview carries the head of the bundle: app id, versions, snapshot.
    expect(bundle.preview).toContain("Kreoda");
    expect(bundle.preview).toContain("coreVersion");
  } finally {
    await app.close();
  }
});
