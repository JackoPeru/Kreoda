import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as refs from "../src/reference/store";

const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII=";
beforeEach(() => vi.stubGlobal("Image", class {
  naturalWidth = 1; naturalHeight = 1; onload?: () => void;
  set src(_value: string) { queueMicrotask(() => this.onload?.()); }
}));
afterEach(async () => { await refs.loadReferences("[]"); vi.unstubAllGlobals(); });

it("restores the image and calibration after replacing the document", async () => {
  const p = refs.addReferencePlane({ name: 'plate "A"', dataUrl: image, imageW: 1, imageH: 1 });
  refs.updateReferencePlane(p.id, { ...refs.calibrateSize(1, 1, [0, 0], [1, 0], 100), plane: "XZ", opacity: 0.4 });
  const expected = refs.useReferenceStore.getState().planes;
  const saved = refs.serializeReferences();
  await refs.loadReferences("[]");
  expect(refs.useReferenceStore.getState().planes).toEqual([]);
  await refs.loadReferences(saved);
  expect(refs.useReferenceStore.getState().planes).toEqual(expected);
});

it("blocks a lossy save when reference metadata is corrupt", async () => {
  await refs.loadReferences(JSON.stringify([{ dataUrl: "https://example.com/image.png" }]));
  expect(refs.useReferenceStore.getState().planes).toEqual([]);
  expect(refs.useReferenceStore.getState().loadError).toMatch(/reference/i);
  expect(() => refs.serializeReferences()).toThrow(/reference/i);
  await refs.loadReferences("[]");
  expect(refs.serializeReferences()).toBe("[]");
});

it("rejects duplicate identifiers and out of range calibration", async () => {
  const p = refs.addReferencePlane({ name: "plate", dataUrl: image, imageW: 200, imageH: 100 });
  await refs.loadReferences(JSON.stringify([p, p]));
  expect(refs.useReferenceStore.getState().loadError).toBeTruthy();
  await refs.loadReferences(JSON.stringify([{ ...p, widthMm: Infinity }]));
  expect(refs.useReferenceStore.getState().loadError).toBeTruthy();
});

it("rejects an oversized image even when metadata claims small dimensions", async () => {
  const p = refs.addReferencePlane({ name: "plate", dataUrl: image, imageW: 200, imageH: 100 });
  const bytes = Uint8Array.from(atob(image.split(",")[1]!), c => c.charCodeAt(0));
  new DataView(bytes.buffer).setUint32(16, 16000);
  new DataView(bytes.buffer).setUint32(20, 16000);
  const forged = "data:image/png;base64," + btoa(String.fromCharCode(...bytes));
  await refs.loadReferences(JSON.stringify([{ ...p, dataUrl: forged }]));
  expect(refs.useReferenceStore.getState().planes).toEqual([]);
  expect(refs.useReferenceStore.getState().loadError).toBeTruthy();
});

it("rejects dimensions that would change calibration for the image", async () => {
  const p = refs.addReferencePlane({ name: "mismatch", dataUrl: image, imageW: 200, imageH: 100 });
  await refs.loadReferences(JSON.stringify([p]));
  expect(refs.useReferenceStore.getState().planes).toEqual([]);
  expect(() => refs.serializeReferences()).toThrow(/reference/i);
});
