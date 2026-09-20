// Plugin manifest validation (§47).
import { describe, expect, it } from "vitest";
import { validateManifest } from "./index.js";

const good = {
  id: "plugin.demo.boxes",
  version: "0.1.0",
  label: "Demo",
  capabilities: [],
  commands: [
    {
      id: "plugin.demo.boxes.pair",
      label: "Two boxes",
      allowedCoreCommands: ["CreateBox"],
    },
  ],
};

describe("validateManifest", () => {
  it("accepts a well-formed manifest", () => {
    expect(validateManifest(good)).toEqual(good);
  });

  it("rejects id/version/capability abuse", () => {
    expect(() => validateManifest({ ...good, id: "evil" })).toThrow(/plugin/);
    expect(() => validateManifest({ ...good, id: "PLUGIN.x.y" })).toThrow();
    expect(() => validateManifest({ ...good, version: "1" })).toThrow(/version/);
    expect(() =>
      validateManifest({ ...good, capabilities: ["fs"] }),
    ).toThrow(/capabilit/);
    expect(() =>
      validateManifest({
        ...good,
        commands: [
          { id: "other.cmd", label: "x", allowedCoreCommands: ["CreateBox"] },
        ],
      }),
    ).toThrow(/start with/);
    expect(() =>
      validateManifest({
        ...good,
        commands: [
          { id: "plugin.demo.boxes.a", label: "x", allowedCoreCommands: [] },
        ],
      }),
    ).toThrow(/allowedCoreCommands/);
  });
});
