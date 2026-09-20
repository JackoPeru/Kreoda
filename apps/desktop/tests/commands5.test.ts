import { describe, expect, it, beforeEach } from "vitest";
import {
  CreateBooleanPayloadSchema,
  CreateChamferPayloadSchema,
  CreateFilletPayloadSchema,
  CreateHolePayloadSchema,
} from "@intentcad/protocol";
import {
  commandAvailability,
  visibleCommands,
} from "../src/commands/execute";
import { useDocumentUiStore, useSelectionStore } from "../src/stores";

beforeEach(() => {
  useSelectionStore.getState().clear();
  // Availability gates on a connected engine (M11) — simulate it.
  useDocumentUiStore.getState().setCoreStatus(true, "test");
});

describe("Phase 5 command registry (§19)", () => {
  it("freezes every command while the engine is down (M11)", async () => {
    const { executeCommand } = await import("../src/commands/execute");
    useDocumentUiStore.getState().setCoreStatus(false, null);
    useSelectionStore.getState().select("box-1:box.+Z", false);
    expect(commandAvailability("CreateHole").available).toBe(false);
    expect(commandAvailability("CreateHole").reason).toMatch(/not running/);
    await expect(executeCommand("CreateHole", {})).rejects.toThrow(
      /not running/,
    );
    useDocumentUiStore.getState().setCoreStatus(true, "test");
    expect(commandAvailability("CreateHole").available).toBe(true);
  });

  it("gates hole on face selection", () => {
    expect(commandAvailability("CreateHole").available).toBe(false);
    useSelectionStore.getState().select("box-1:box.+Z", false);
    expect(commandAvailability("CreateHole").available).toBe(true);
  });

  it("gates fillet/chamfer on edge selection", () => {
    expect(commandAvailability("CreateFillet").available).toBe(false);
    useSelectionStore
      .getState()
      .select("box-1:edge.lin.box.+X~box.+Z", false);
    expect(commandAvailability("CreateFillet").available).toBe(true);
    expect(commandAvailability("CreateChamfer").available).toBe(true);
  });

  it("gates boolean on two body selections", () => {
    expect(commandAvailability("CreateBoolean").available).toBe(false);
    useSelectionStore.getState().select("box-1", false);
    expect(commandAvailability("CreateBoolean").available).toBe(false);
    useSelectionStore.getState().select("box-2", true);
    expect(commandAvailability("CreateBoolean").available).toBe(true);
  });

  it("exposes the new commands in the toolbar", () => {
    const ids = visibleCommands().map((c) => c.id);
    for (const id of [
      "CreateBoolean",
      "CreateHole",
      "CreateFillet",
      "CreateChamfer",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("validates boolean/hole/fillet payloads", () => {
    expect(
      CreateBooleanPayloadSchema.parse({
        featureId: "u",
        op: "cut",
        targetId: "a",
        toolId: "b",
      }),
    ).toBeTruthy();
    expect(() =>
      CreateBooleanPayloadSchema.parse({
        featureId: "u",
        op: "nope",
        targetId: "a",
        toolId: "b",
      }),
    ).toThrow();
    expect(
      CreateHolePayloadSchema.parse({
        featureId: "h",
        targetId: "a",
        faceRole: "box.+Z",
        xMm: 50,
        yMm: 25,
        diameterMm: 8,
        depthMode: "throughAll",
        depthMm: 0,
      }),
    ).toBeTruthy();
    expect(() =>
      CreateFilletPayloadSchema.parse({
        featureId: "f",
        targetId: "a",
        edgeIds: [],
        radiusMm: 3,
      }),
    ).toThrow();
    expect(
      CreateChamferPayloadSchema.parse({
        featureId: "c",
        targetId: "a",
        edgeIds: ["a:edge.lin.box.+X~box.+Z"],
        distanceMm: 2,
      }),
    ).toBeTruthy();
  });
});
