import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot, addBox, snapOf, openProperties } from "./helpers";

type ConfigurationState = {
  revision: number;
  active: string;
  named: Record<string, Record<string, Record<string, number>>>;
};

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
    const before = await call<ConfigurationState>("query");
    expect(before.revision).toBe(initial.revision);
    const afterRead = await call<{ revision: number }>("query");
    expect(afterRead.revision).toBe(before.revision);
    await call("define", "Medium", { [first!.id]: { widthMm: 150 } });
    const defined = await call<ConfigurationState>("query");
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

    // A sparse named configuration can affect several real OCCT solids. The
    // already active Medium definition gains a second box without losing the
    // first override; activation re-queries the renderer after native changes.
    const mediumOverrides = {
      [first!.id]: { widthMm: 150 },
      [second!.id]: { widthMm: 125 },
    };
    await call("define", "Medium", mediumOverrides);
    const mediumDefined = await call<ConfigurationState>("query");
    expect(mediumDefined.named.Medium).toEqual(mediumOverrides);
    expect(mediumDefined.active).toBe("Medium");
    await call("activate", "Medium");

    const baseFirst = [...first!.paramsMm];
    const baseSecond = [...second!.paramsMm];
    expect(baseFirst).toHaveLength(3);
    expect(baseSecond).toHaveLength(3);
    const mediumFirst = [150, baseFirst[1]!, baseFirst[2]!];
    const mediumSecond = [125, baseSecond[1]!, baseSecond[2]!];
    const largeFirst = [baseFirst[0]!, 70, baseFirst[2]!];

    const checkState = async (active: string, expectedFirst: number[], expectedSecond: number[]) => {
      const snapshot = await snapOf(window);
      expect(snapshot.bodies).toHaveLength(2);
      const bodies = [first!.id, second!.id].map(id => snapshot.bodies.find(body => body.id === id));
      for (const [index, body] of bodies.entries()) {
        expect(body, `missing real native body ${index}`).toBeDefined();
        expect(body!.triangles).toBeGreaterThan(0);
        const params = index === 0 ? expectedFirst : expectedSecond;
        expect(body!.paramsMm).toHaveLength(params.length);
        for (let i = 0; i < params.length; i++) expect(body!.paramsMm[i]).toBeCloseTo(params[i]!, 6);
        expect(body!.volumeMm3).toBeCloseTo(params.reduce((v, p) => v * p, 1), 2);
      }
      const state = await call<ConfigurationState>("query");
      expect(state.active).toBe(active);
      expect(state.revision).toBe(snapshot.revision);
      expect(state.named.Medium).toEqual(mediumOverrides);
      expect(state.named.Large).toEqual({ [first!.id]: { heightMm: 70 } });
      return state.revision;
    };

    // Large deliberately omits Medium's overrides. Both boxes must return to
    // their own persisted baseline before Large's one override is applied.
    await call("define", "Large", { [first!.id]: { heightMm: 70 } });
    const largeDefined = await call<ConfigurationState>("query");
    expect(largeDefined.active).toBe("Medium");
    expect(largeDefined.named.Large).toEqual({ [first!.id]: { heightMm: 70 } });
    await checkState("Medium", mediumFirst, mediumSecond);
    await call("activate", "Large");
    await checkState("Large", largeFirst, baseSecond);
    await call("undo");
    await checkState("Medium", mediumFirst, mediumSecond);
    await call("redo");
    await checkState("Large", largeFirst, baseSecond);

    // Native reserves the empty name for Base. Undo/Redo must restore both
    // geometry and active metadata, including the second sparse box.
    await call("activate", "");
    await checkState("", baseFirst, baseSecond);
    await call("undo");
    await checkState("Large", largeFirst, baseSecond);
    await call("redo");
    await checkState("", baseFirst, baseSecond);

    await window.evaluate(p => (window as unknown as { __kreoda_test: { saveIcad: (p: string) => Promise<unknown> } }).__kreoda_test.saveIcad(p), filename);
    await window.evaluate(p => (window as unknown as { __kreoda_test: { openIcad: (p: string) => Promise<unknown> } }).__kreoda_test.openIcad(p), filename);
    await checkState("", baseFirst, baseSecond);

    // Path independence: direct Base→Large and Medium→Large give precisely
    // the same two sets of source dimensions and B-Rep volumes after reopen.
    await call("activate", "Large");
    await checkState("Large", largeFirst, baseSecond);
    await call("activate", "Medium");
    await checkState("Medium", mediumFirst, mediumSecond);
    await call("activate", "Large");
    await checkState("Large", largeFirst, baseSecond);
    await window.evaluate(p => (window as unknown as { __kreoda_test: { saveIcad: (p: string) => Promise<unknown> } }).__kreoda_test.saveIcad(p), filename);
    await window.evaluate(p => (window as unknown as { __kreoda_test: { openIcad: (p: string) => Promise<unknown> } }).__kreoda_test.openIcad(p), filename);
    await checkState("Large", largeFirst, baseSecond);
  } finally {
    await app.close();
    try { fs.unlinkSync(filename); } catch { /* test may fail before save */ }
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
