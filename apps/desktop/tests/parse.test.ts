import { describe, expect, it } from "vitest";
import { describeStep, parseCommand } from "../src/intent/parse";
import { validatePlan } from "../src/intent/provider";
import type { IntentPlan } from "../src/intent/parse";

const planOf = (text: string): IntentPlan => {
  const r = parseCommand(text);
  if (!r.ok) throw new Error(`should parse: ${r.message}`);
  return r.plan;
};

describe("local command parser (§57)", () => {
  it("parses primitives with units", () => {
    expect(planOf("box 100 50 20").steps).toEqual([
      {
        command: "CreateBox",
        params: { widthMm: 100, heightMm: 50, depthMm: 20 },
      },
    ]);
    expect(planOf("plate 100 60 10").steps[0]!.command).toBe("CreateBox");
    expect(planOf("tube 20 60").steps[0]).toMatchObject({
      command: "CreateCylinder",
    });
    expect(planOf("ball 25mm").steps[0]).toMatchObject({
      command: "CreateSphere",
    });
  });

  it("rejects bad dimensions with usage help", () => {
    const r = parseCommand("box 100 -5");
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "invalid") expect(r.message).toMatch(/Usage/);
    else throw new Error("expected invalid+usage");
  });

  it("parses hole and corner-hole patterns", () => {
    expect(planOf("hole 8").steps).toEqual([
      {
        command: "CreateHole",
        params: {
          diameterMm: 8,
          depthMode: "throughAll",
          depthMm: 0,
          position: "center",
        },
      },
    ]);
    expect(planOf("hole 8 blind 5").steps[0]!.params).toMatchObject({
      depthMode: "blind",
      depthMm: 5,
    });
    expect(planOf("holes 6 4 corners 8").steps).toEqual([
      {
        command: "CreateHolesCorners",
        params: {
          diameterMm: 6,
          count: 4,
          insetMm: 8,
          depthMode: "throughAll",
          depthMm: 0,
        },
      },
    ]);
    expect(planOf("holes 6 corners 8 blind 5").steps[0]!.params).toMatchObject({
      count: 4,
      depthMode: "blind",
      depthMm: 5,
    });
    expect(planOf("holes 6 count 1 corners 8").steps[0]!.params).toMatchObject({
      count: 1,
    });
  });

  it("rejects unsupported corner counts", () => {
    const r = parseCommand("holes 6 3 corners 8");
    expect(r.ok).toBe(false);
  });

  it("parses fillet/chamfer/set/undo/view", () => {
    expect(planOf("fillet 3").steps[0]).toMatchObject({
      command: "CreateFillet",
    });
    expect(planOf("chamfer 2").steps[0]).toMatchObject({
      command: "CreateChamfer",
    });
    expect(planOf("set widthMm 150").steps[0]).toMatchObject({
      command: "SetDimension",
    });
    expect(planOf("undo").steps[0]!.command).toBe("Undo");
    expect(planOf("view front").steps[0]).toMatchObject({
      command: "View",
    });
    expect(planOf("top").steps[0]).toMatchObject({ command: "View" });
  });

  it("routes prose to unparsed (provider layer)", () => {
    const r = parseCommand("make me a bracket with four holes");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unparsed");
    else throw new Error("expected unparsed");
  });

  it("answers export honestly (toolbar, not silent)", () => {
    const r = parseCommand("export step");
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "invalid") expect(r.message).toMatch(/toolbar/);
    else throw new Error("expected invalid+toolbar");
  });

  it("describes steps for preview", () => {
    expect(describeStep(planOf("box 100 50 20").steps[0]!)).toBe(
      "Box 100×50×20 mm",
    );
    expect(describeStep(planOf("holes 6 4 corners 8").steps[0]!)).toMatch(
      /4.*⌀6/,
    );
  });

  it("validates plans (empty / too long / unknown command)", () => {
    expect(() => validatePlan({ steps: [], source: "local", text: "" })).toThrow();
    expect(() =>
      validatePlan({
        steps: [{ command: "Nope", params: {} }] as unknown as IntentPlan["steps"],
        source: "llm",
        text: "",
      }),
    ).toThrow(/Unknown command/);
    // Local UI-level shorthand passes structural validation.
    expect(() => validatePlan(planOf("hole 8"))).not.toThrow();
    // LLM output with bad types is rejected by zod.
    expect(() =>
      validatePlan({
        steps: [{ command: "CreateBox", params: { widthMm: "big" } }],
        source: "llm",
        text: "",
      } as unknown as IntentPlan),
    ).toThrow();
  });
});
