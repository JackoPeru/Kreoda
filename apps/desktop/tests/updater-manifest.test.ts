// Update manifest validation + version compare (Phase 8 updater).
import { describe, expect, it } from "vitest";
import {
  isNewer,
  parseManifest,
  signedPayloadBytes,
} from "../src/updater/manifest";

const good = {
  version: "0.2.0",
  url: "https://example.com/intentcad-0.2.0.exe",
  sha256: "a".repeat(64),
  signature: "c2ln",
};

describe("update manifest", () => {
  it("accepts a well-formed manifest", () => {
    expect(parseManifest(good)).toEqual({ ...good });
  });

  it("rejects garbage honestly", () => {
    expect(() => parseManifest(null)).toThrow(/object/);
    expect(() => parseManifest({ ...good, version: "v2" })).toThrow(/version/);
    expect(() => parseManifest({ ...good, version: "1.2" })).toThrow(/version/);
    expect(() => parseManifest({ ...good, url: "http://evil.com/x" })).toThrow(
      /https/,
    );
    expect(() =>
      parseManifest({ ...good, url: "http://localhost:9/x" }),
    ).not.toThrow();
    expect(() => parseManifest({ ...good, sha256: "zz" })).toThrow(/sha256/);
    const { signature: _dropped, ...unsigned } = good;
    expect(() => parseManifest(unsigned)).toThrow(/signature/);
  });

  it("compares versions numerically", () => {
    expect(isNewer("0.1.0", "0.2.0")).toBe(true);
    expect(isNewer("0.1.0", "0.1.10")).toBe(true);
    expect(isNewer("0.2.0", "0.2.0")).toBe(false);
    expect(isNewer("0.2.0", "0.1.9")).toBe(false);
    expect(isNewer("0.1.0", "0.10.0")).toBe(true);
    expect(isNewer("bogus", "0.2.0")).toBe(false);
    expect(isNewer("0.1.0", "bogus")).toBe(false);
  });

  it("signs deterministic bytes", () => {
    const bytes = signedPayloadBytes(good);
    expect(new TextDecoder().decode(bytes)).toBe(
      `0.2.0\nhttps://example.com/intentcad-0.2.0.exe\n${"a".repeat(64)}`,
    );
  });
});
