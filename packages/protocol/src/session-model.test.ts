import { describe, expect, it } from "vitest";
import {
  applySessionModelDelta,
  type SessionIncrementalDelta,
  type SessionModelSnapshot,
} from "./session-model.js";

const entity = (id: string, extra: Record<string, unknown> = {}) => ({ featureId: id, ...extra });
const body = (id: string, extra: Record<string, unknown> = {}) => ({ bodyId: id, ...extra });

function model(): SessionModelSnapshot {
  return {
    sessionId: "session-a",
    documentId: "doc-a",
    revision: 4,
    features: [entity("a"), entity("b"), entity("gone"), entity("shared")],
    sketches: [entity("shared", { points: [1, 2] }), entity("gone")],
    bodies: [body("body-a"), body("body-b"), body("gone")],
  };
}

function delta(overrides: Partial<SessionIncrementalDelta> = {}): SessionIncrementalDelta {
  return {
    event: "delta",
    baseRevision: 4,
    newRevision: 5,
    revision: 5,
    sessionId: "session-a",
    documentId: "doc-a",
    originClientId: "client-a",
    added: [],
    updated: [],
    removedIds: [],
    changedMeshIds: ["b"],
    referenceRemaps: [{ from: "face-old", to: "face-new" }],
    warnings: ["native warning"],
    ...overrides,
  };
}

describe("session model delta application", () => {
  it("patches ordered entity lists by kind and preserves metadata", () => {
    const current = model();
    const result = applySessionModelDelta(current, delta({
      added: [{ kind: "feature", id: "c", index: 1, value: entity("c") }],
      updated: [
        { kind: "feature", id: "b", index: 0, value: entity("b", { edited: true }) },
        { kind: "body", id: "body-b", index: 0, value: body("body-b", { tip: "b" }) },
      ],
      removedIds: ["gone"],
    }));

    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    expect(result.model.features.map((value) => value["featureId"]))
      .toEqual(["b", "c", "a", "shared"]);
    expect(result.model.sketches.map((value) => value["featureId"]))
      .toEqual(["shared"]);
    expect(result.model.bodies.map((value) => value["bodyId"]))
      .toEqual(["body-b", "body-a"]);
    expect(result.model.features.find((value) => value["featureId"] === "b")?.["edited"])
      .toBe(true);
    expect(result.referenceRemaps).toEqual([{ from: "face-old", to: "face-new" }]);
    expect(result.warnings).toEqual(["native warning"]);
    expect(result.model.revision).toBe(5);
    expect(current.revision).toBe(4);
  });

  it("accepts feature and sketch entities sharing an ID", () => {
    const result = applySessionModelDelta(model(), delta({
      added: [{
        kind: "sketch",
        id: "same",
        index: 2,
        value: entity("same", { model: { points: [{ x: 1, y: 2 }] } }),
      }],
    }));
    expect(result.status).toBe("applied");
    if (result.status === "applied") {
      expect(result.model.sketches.at(-1)?.["featureId"]).toBe("same");
    }
  });

  it("drops same-lineage duplicates but requests a snapshot before comparing lineage revisions", () => {
    const current = { ...model(), revision: 9 };
    expect(applySessionModelDelta(current, delta({ newRevision: 8, revision: 8 })))
      .toMatchObject({ status: "duplicate" });
    expect(applySessionModelDelta(current, delta({
      sessionId: "session-old",
      newRevision: 8,
      revision: 8,
    }))).toMatchObject({ status: "needs-snapshot", reason: "lineage" });
  });

  it("requests a snapshot when base revision does not match", () => {
    expect(applySessionModelDelta(model(), delta({ baseRevision: 3 })))
      .toMatchObject({ status: "needs-snapshot", reason: "gap" });
  });

  it.each([
    { kind: "mesh", id: "x", index: 0, value: { id: "x" } },
    { kind: "feature", id: "x", index: 0, value: entity("different") },
    { kind: "feature", id: "x", index: -1, value: entity("x") },
    { kind: "feature", id: "x", index: 99, value: entity("x") },
  ])("rejects malformed entity records without applying them", (record) => {
    expect(applySessionModelDelta(model(), delta({
      added: [record as SessionIncrementalDelta["added"][number]],
    }))).toMatchObject({ status: "needs-snapshot", reason: "malformed" });
  });
});
