// Phase 3 E2E: dimension editing via the properties panel (§22).
// Type an exact value → one committed transaction → exact OCCT geometry.

import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import { HERE, MAIN, addBox, openProject, openProperties } from "./helpers";

test("panel dimension edit commits exact geometry", async () => {
  const app = await electron.launch({
    args: [MAIN, "--no-sandbox"],
  });
  try {
    const window = await app.firstWindow({ timeout: 30000 });
    await window.waitForLoadState("domcontentloaded");
    await expect(window.getByText(/core 0\.1\.0/)).toBeVisible({
      timeout: 20000,
    });

    await addBox(window);
    await window.getByRole("button", { name: "Create" }).click();
    await openProject(window);
    await expect(window.getByText(/Box 100×50×20/)).toBeVisible({
      timeout: 20000,
    });

    // Select the body → properties drawer with dimension fields.
    await window.getByText(/Box 100×50×20/).click();
    await openProperties(window);
    const panel = window.getByTestId("properties");
    await expect(panel).toBeVisible();
    const width = panel.getByLabel(/Width/);
    await width.fill("200");
    await width.press("Enter");

    // Exact recompute through the DAG, one revision step.
    await expect(window.getByText(/Box 200×50×20/)).toBeVisible({
      timeout: 20000,
    });
    await window.screenshot({ path: path.join(HERE, "phase3-panel.png") });
  } finally {
    await app.close();
  }
});
