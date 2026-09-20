import { describe, expect, it, afterEach } from "vitest";
import {
  dismissedIds,
  dismissSuggestion,
  suggestEqualHoles,
  suggestIntent,
  suggestionKey,
} from "../src/intent/suggest";
import type { FeatureSummary } from "../src/ipc/coreClient";

const hole = (
  id: string,
  diameter: number,
): FeatureSummary => ({
  featureId: id,
  type: "Hole",
  paramsMm: [diameter, 0],
  dependsOn: ["box-1"],
  refExtra: "",
  volumeMm3: 1000,
});

const box: FeatureSummary = {
  featureId: "box-1",
  type: "Box",
  paramsMm: [100, 50, 10],
  dependsOn: [],
  refExtra: "",
  volumeMm3: 50000,
};

describe("IntentEngine equal-holes (§27)", () => {
  afterEach(() => {
    // Test hygiene: dismissal persists in real localStorage.
    localStorage.removeItem("intentcad.dismissedSuggestions");
  });
  it("stays silent with fewer than two holes", () => {
    expect(suggestEqualHoles([box, hole("h1", 8)])).toBeNull();
  });

  it("stays silent when holes already agree (no nagging)", () => {
    expect(
      suggestEqualHoles([box, hole("h1", 8), hole("h2", 8)]),
    ).toBeNull();
  });

  it("suggests unifying near-identical diameters", () => {
    const s = suggestEqualHoles([box, hole("h1", 8), hole("h2", 8.4)]);
    expect(s).not.toBeNull();
    expect(s!.kind).toBe("equalSize");
    expect(s!.ids).toContain("h1");
    expect(s!.ids).toContain("h2");
  });

  it("stays silent for wildly different diameters", () => {
    expect(suggestEqualHoles([box, hole("h1", 8), hole("h2", 20)])).toBeNull();
  });

  it("ignores non-hole features", () => {
    expect(suggestIntent([box])).toBeNull();
  });

  it("dismissal keys are stable and round-trip", () => {
    const s = suggestEqualHoles([box, hole("h1", 8), hole("h2", 8.4)])!;
    const key = suggestionKey(s);
    expect(key).toContain("h1");
    dismissSuggestion(key);
    expect(dismissedIds()).toContain(key);
  });
});
