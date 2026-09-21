// Shared E2E harness: boot, snapshot, command-bar run. Every spec launches
// the same Electron shell and reads the same __kreoda_test projection;
// per-spec files keep only their ICAD paths, WS ports and assertions.
import { expect, _electron as electron, type Page } from "@playwright/test";
import path from "node:path";

export const HERE = import.meta.dirname;
export const MAIN = path.join(HERE, "..", ".vite", "build", "main.cjs");

export interface BodySnapshot {
  id: string;
  type: string;
  paramsMm: number[];
  volumeMm3: number;
  triangles: number;
  faces: string[];
  edgeCount: number;
  expressions: Record<string, string>;
}

export interface SketchSnapshot {
  id: string;
  planeKind: string;
  points: number;
  constraints: number;
}

export interface Snapshot {
  revision: number;
  selectedIds: string[];
  bodies: BodySnapshot[];
  sketches: SketchSnapshot[];
  /** Slice 4 tip flow: rendered scene contents (= mesh map keys). */
  tips?: string[];
  /** Slice 4 Body projection: id/history/tip per body (tree source). */
  treeBodies?: { id: string; history: string[]; tip: string }[];
}

/** Launch the shell, wait for DOM + sidecar handshake. */
export async function boot(env?: Record<string, string>) {
  const app = await electron.launch({
    args: [MAIN, "--no-sandbox"],
    ...(env ? { env } : {}),
  });
  const window = await app.firstWindow({ timeout: 30000 });
  await window.waitForLoadState("domcontentloaded");
  await expect(window.getByText(/core 0\.1\.0/)).toBeVisible({
    timeout: 20000,
  });
  return { app, window };
}

export function snapOf(window: Page): Promise<Snapshot> {
  return window.evaluate(() =>
    (
      window as unknown as {
        __kreoda_test: { snapshot: () => Snapshot };
      }
    ).__kreoda_test.snapshot(),
  ) as Promise<Snapshot>;
}

/** Run one command-bar step; fail loudly on plan errors (never poll blind). */
export async function runBar(window: Page, text: string): Promise<void> {
  const input = window.getByTestId("command-input");
  await input.fill(text);
  await input.press("Enter");
  const preview = window.getByTestId("plan-preview");
  await expect(preview).toBeVisible({ timeout: 5000 });
  await preview.getByRole("button", { name: /Run 1 step/ }).click();
  await expect(preview).toBeHidden({ timeout: 120000 });
  const failures = await window
    .getByText(/Stopped after|planning failed|execution failed/)
    .allTextContents();
  expect(
    failures.length === 0 ? "" : `plan failed: ${failures.join(" | ")}`,
  ).toBe("");
}

/** UX-1 shell: open the project drawer (ObjectTree lives there now). */
export async function openProject(window: Page): Promise<void> {
  await window.getByRole("button", { name: "Project" }).click();
  await expect(window.getByTestId("project-drawer")).toBeVisible({
    timeout: 5000,
  });
}

/** UX-1 shell: open the More menu (advanced actions live there now). */
export async function openMore(window: Page): Promise<void> {
  await window
    .getByTestId("workspace-topdock")
    .getByRole("button", { name: "More" })
    .click();
  await expect(window.getByTestId("more-menu")).toBeVisible({
    timeout: 5000,
  });
}

/** UX-1 shell: open the properties drawer via More → Properties. */
export async function openProperties(window: Page): Promise<void> {
  await openMore(window);
  await window
    .getByTestId("more-menu")
    .getByRole("button", { name: "Properties" })
    .click();
  await expect(window.getByTestId("properties-drawer")).toBeVisible({
    timeout: 5000,
  });
}

/** UX-1 shell: Add-button popover → primitive dialog. */
export async function addBox(window: Page): Promise<void> {
  await window.getByRole("button", { name: "Add", exact: true }).click();
  await window.getByRole("button", { name: /Add box/ }).click();
}
