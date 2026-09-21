import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { FeatureSummary } from "../src/ipc/coreClient";
import { useDocumentUiStore, useSelectionStore } from "../src/stores";
import { ObjectTree } from "../src/components/ObjectTree";

function feat(
  featureId: string,
  type: string,
  dependsOn: string[] = [],
  paramsMm: number[] = [],
): FeatureSummary {
  return {
    featureId,
    type,
    paramsMm,
    volumeMm3: 1000,
    dependsOn,
    refExtra: "",
    expressions: {},
  };
}

const box = () => feat("box-1", "Box", [], [100, 50, 10]);
const hole = () => feat("ho-1", "Hole", ["box-1"], [8, 0]);
const fillet = () => feat("fi-1", "Fillet", ["ho-1"], [2]);

beforeEach(() => {
  useDocumentUiStore.getState().resetDocument("doc-test");
  useSelectionStore.getState().clear();
});

afterEach(() => cleanup());

describe("ObjectTree (Slice 4 bodies + history)", () => {
  it("single-root body renders flat with the legacy label", () => {
    useDocumentUiStore.getState().setFeatures([box()], 1);
    render(<ObjectTree />);
    expect(screen.getByText("Box 100×50×10")).toBeTruthy();
    expect(screen.queryByText(/Body \d/)).toBeNull();
  });

  it("multi-feature body expands history and selects features", () => {
    useDocumentUiStore.getState().setFeatures([box(), hole(), fillet()], 3);
    render(<ObjectTree />);
    expect(screen.getByText("▾ Body 1")).toBeTruthy();
    expect(screen.getByText("Hole 8×0")).toBeTruthy();
    fireEvent.click(screen.getByTestId("object-tree-ho-1"));
    expect(useSelectionStore.getState().selectedIds).toEqual(["ho-1"]);
    // Collapse hides history; expand restores it.
    fireEvent.click(screen.getByTestId("object-tree-body-box-1"));
    expect(screen.queryByText("Hole 8×0")).toBeNull();
    fireEvent.click(screen.getByTestId("object-tree-body-box-1"));
    expect(screen.getByText("Fillet 2")).toBeTruthy();
  });
});
