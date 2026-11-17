import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot, runBar, snapOf } from "./helpers";

test("canonical assembly mate47 aligns separate instance origins in real OCCT", async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "kreoda-mate-profile-"));
  const saved = path.join(profile, "mated.icad");
  const { app, window } = await boot({ KREODA_BACKGROUND_TEST: "1" }, [`--user-data-dir=${profile}`]);
  try {
    await runBar(window, "box 20 15 10");
    const source = (await snapOf(window)).bodies.find(b => b.type === "Box")!;
    expect(source).toBeTruthy();
    const invoke = (method: "instance" | "ground" | "coincident", args: unknown[]) => window.evaluate(({ method, args }) => {
      const actions = (window as unknown as { __kreoda_test: { assemblyMateE2E: Record<string, (...v: unknown[]) => Promise<unknown>> } }).__kreoda_test.assemblyMateE2E;
      return actions[method](...args);
    }, { method, args });
    const fixed = await invoke("instance", [source.id, 10, 20, 30]) as string;
    const moving = await invoke("instance", [source.id, -15, 7, 50]) as string;
    await invoke("ground", [fixed]);
    const before = await snapOf(window);
    const anchor = before.bodies.find(b => b.id === fixed)!;
    const displaced = before.bodies.find(b => b.id === moving)!;
    expect(anchor).toBeTruthy(); expect(displaced).toBeTruthy();
    expect(displaced.paramsMm.slice(0, 3)).not.toEqual(anchor.paramsMm.slice(0, 3));
    await invoke("coincident", [moving, fixed]);
    const after = await snapOf(window);
    expect(after.revision).toBe(before.revision + 1);
    expect(after.bodies.find(b => b.id === moving)?.paramsMm.slice(0, 3)).toEqual(anchor.paramsMm.slice(0, 3));
    await window.evaluate(() => (window as unknown as { __kreoda_test: { configurationE2E: { undo: () => Promise<void> } } }).__kreoda_test.configurationE2E.undo());
    expect((await snapOf(window)).bodies.find(b => b.id === moving)?.paramsMm.slice(0, 3)).toEqual(displaced.paramsMm.slice(0, 3));
    await window.evaluate(() => (window as unknown as { __kreoda_test: { configurationE2E: { redo: () => Promise<void> } } }).__kreoda_test.configurationE2E.redo());
    expect((await snapOf(window)).bodies.find(b => b.id === moving)?.paramsMm.slice(0, 3)).toEqual(anchor.paramsMm.slice(0, 3));
    await window.evaluate(file => (window as unknown as { __kreoda_test: { saveIcad: (p: string) => Promise<unknown> } }).__kreoda_test.saveIcad(file), saved);
    await window.evaluate(file => (window as unknown as { __kreoda_test: { openIcad: (p: string) => Promise<unknown> } }).__kreoda_test.openIcad(file), saved);
    expect((await snapOf(window)).bodies.find(b => b.id === moving)?.paramsMm.slice(0, 3)).toEqual(anchor.paramsMm.slice(0, 3));
  } finally { await app.close(); fs.rmSync(profile, { recursive: true, force: true }); }
});
