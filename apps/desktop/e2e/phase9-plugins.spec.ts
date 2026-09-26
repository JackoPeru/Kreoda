// Phase 9b E2E (§47): sandboxed plugins end to end.
// A plugin registered from source builds two boxes through the typed core
// path; a capability escape and a throwing plugin fail honestly without
// taking the app down.

import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import { HERE, MAIN, type Snapshot } from "./helpers";

const PAIR_PLUGIN = `
kreoda.register({
  id: "plugin.e2e.pair",
  version: "0.1.0",
  label: "E2E pair",
  capabilities: [],
  commands: [{
    id: "plugin.e2e.pair.make",
    label: "Make pair",
    allowedCoreCommands: ["CreateBox"],
  }],
});
kreoda.onCommand("plugin.e2e.pair.make", async (params) => {
  await kreoda.invoke("CreateBox", {
    featureId: params.a, widthMm: 10, heightMm: 10, depthMm: 10,
  });
  await kreoda.invoke("CreateBox", {
    featureId: params.b, widthMm: 20, heightMm: 20, depthMm: 20,
  });
  return { made: 2 };
});
`;

const ESCAPE_PLUGIN = `
kreoda.register({
  id: "plugin.e2e.escape",
  version: "0.1.0",
  label: "E2E escape",
  capabilities: [],
  commands: [{
    id: "plugin.e2e.escape.try",
    label: "Try escape",
    allowedCoreCommands: ["CreateBox"],
  }],
});
kreoda.onCommand("plugin.e2e.escape.try", async () => {
  await kreoda.invoke("CreateCylinder", { featureId: "evil", radiusMm: 1, heightMm: 1 });
});
`;

const THROWING_PLUGIN = `
kreoda.register({
  id: "plugin.e2e.boom",
  version: "0.1.0",
  label: "E2E boom",
  capabilities: [],
  commands: [{
    id: "plugin.e2e.boom.go",
    label: "Go boom",
    allowedCoreCommands: ["CreateBox"],
  }],
});
kreoda.onCommand("plugin.e2e.boom.go", async () => {
  throw new Error("boom from inside the sandbox");
});
`;

test("plugins: sandboxed commands, escapes refused, crashes isolated", async () => {
  const app = await electron.launch({
    args: [MAIN, "--no-sandbox", "--lang=en-US"],
  });
  try {
    const window = await app.firstWindow({ timeout: 30000 });
    await window.waitForLoadState("domcontentloaded");
    await expect(window.getByText(/core 0\.1\.0/)).toBeVisible({
      timeout: 20000,
    });

    const snap = (): Promise<Snapshot> =>
      window.evaluate(() =>
        (
          window as unknown as {
            __kreoda_test: { snapshot: () => Snapshot };
          }
        ).__kreoda_test.snapshot(),
      );
    const load = (source: string): Promise<unknown> =>
      window.evaluate(
        (src) =>
          (
            window as unknown as {
              __kreoda_test: { loadPluginSource: (s: string) => Promise<unknown> };
            }
          ).__kreoda_test.loadPluginSource(src),
        source,
      );
    const run = (
      pluginId: string,
      commandId: string,
      params: unknown,
    ): Promise<unknown> =>
      window.evaluate(
        ({ p, c, ps }) =>
          (
            window as unknown as {
              __kreoda_test: {
                runPlugin: (a: string, b: string, d: unknown) => Promise<unknown>;
              };
            }
          ).__kreoda_test.runPlugin(p, c, ps),
        { p: pluginId, c: commandId, ps: params },
      );

    // 1. Generator plugin builds real geometry through the typed path.
    await load(PAIR_PLUGIN);
    const made = (await run("plugin.e2e.pair", "plugin.e2e.pair.make", {
      a: "plug-a",
      b: "plug-b",
    })) as { made: number };
    expect(made.made).toBe(2);
    await expect
      .poll(async () => ((await snap()) as Snapshot).bodies.length, {
        timeout: 30000,
      })
      .toBe(2);
    const s1 = (await snap()) as Snapshot;
    // Feature ids are minted core-side (§10) — match by volume instead.
    const vols = s1.bodies.map((b) => b.volumeMm3).sort((a, b) => a - b);
    expect(vols).toHaveLength(2);
    expect(vols[0]).toBeCloseTo(1000, 3);
    expect(vols[1]).toBeCloseTo(8000, 3);

    // 2. Capability escape refused (allowlist is CreateBox only).
    await load(ESCAPE_PLUGIN);
    await expect(
      run("plugin.e2e.escape", "plugin.e2e.escape.try", {}),
    ).rejects.toThrow(/not allowed/);

    // 3. Throwing plugin fails honestly; the app keeps working.
    await load(THROWING_PLUGIN);
    await expect(
      run("plugin.e2e.boom", "plugin.e2e.boom.go", {}),
    ).rejects.toThrow(/boom from inside the sandbox/);
    const s2 = (await snap()) as Snapshot;
    expect(s2.bodies).toHaveLength(2);

    // 4. Bad manifests never load.
    await expect(load("kreoda.register({});")).rejects.toThrow();
    await expect(load("throw new Error('load boom')")).rejects.toThrow();

    await window.screenshot({ path: path.join(HERE, "phase9-plugins.png") });
  } finally {
    await app.close();
  }
});
