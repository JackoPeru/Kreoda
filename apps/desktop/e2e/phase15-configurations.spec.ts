import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot, addBox, snapOf, openProperties } from "./helpers";

test("[solo] native configurations: two solids, B-Rep, undo/redo, persistence and Desktop requery", async () => {
  const filename = path.join(os.tmpdir(), `kreoda-configurations-${process.pid}.icad`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "kreoda-config-profile-"));
  const { app, window } = await boot({ KREODA_BACKGROUND_TEST: "1" }, [`--user-data-dir=${profile}`]);
  const call = <T>(method: string, ...args: unknown[]) => window.evaluate(({ method, args }) => {
    const hook = (window as unknown as { __kreoda_test: { configurationE2E: Record<string, (...a: unknown[]) => unknown> } }).__kreoda_test.configurationE2E;
    return hook[method]!(...args);
  }, { method, args }) as Promise<T>;
  try {
    for (let index = 0; index < 2; index++) {
      await addBox(window);
      await window.getByRole("button", { name: "Create", exact: true }).click();
    }
    const initial = await snapOf(window);
    expect(initial.bodies).toHaveLength(2);
    const [first, second] = initial.bodies;
    const firstVolume = first!.volumeMm3;
    const secondVolume = second!.volumeMm3;
    const before = await call<{ revision: number; active: string; named: object }>("query");
    expect(before.revision).toBe(initial.revision);
    const afterRead = await call<{ revision: number }>("query");
    expect(afterRead.revision).toBe(before.revision);
    await call("define", "Medium", { [first!.id]: { widthMm: 150 } });
    const defined = await call<{ revision: number; named: Record<string, unknown> }>("query");
    expect(defined.named).toHaveProperty("Medium");
    await call("activate", "Medium");
    const activated = await snapOf(window);
    expect(activated.bodies.find(f => f.id === first!.id)!.volumeMm3).toBeCloseTo(firstVolume * 1.5, 2);
    expect(activated.bodies.find(f => f.id === second!.id)!.volumeMm3).toBeCloseTo(secondVolume, 2);
    await call("undo");
    expect((await snapOf(window)).bodies.find(f => f.id === first!.id)!.volumeMm3).toBeCloseTo(firstVolume, 2);
    await call("redo");
    expect((await snapOf(window)).bodies.find(f => f.id === first!.id)!.volumeMm3).toBeCloseTo(firstVolume * 1.5, 2);
    await window.evaluate(p => (window as unknown as { __kreoda_test: { saveIcad: (p: string) => Promise<unknown> } }).__kreoda_test.saveIcad(p), filename);
    await window.evaluate(p => (window as unknown as { __kreoda_test: { openIcad: (p: string) => Promise<unknown> } }).__kreoda_test.openIcad(p), filename);
    expect((await call<{ named: Record<string, unknown> }>("query")).named).toHaveProperty("Medium");
    await openProperties(window);
    await expect(window.getByTestId("configurations-panel")).toContainText("Medium");
  } finally {
    await app.close();
    try { fs.unlinkSync(filename); } catch { /* test may fail before save */ }
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
