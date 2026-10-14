import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DatumDescriptorSchema } from "@kreoda/protocol";
import { ContextToolbar } from "../src/components/ContextToolbar";
import { useDocumentUiStore, useSelectionStore } from "../src/stores";
import { t } from "../src/i18n";

afterEach(() => {
  cleanup();
  useDocumentUiStore.setState({ datums: [], features: [], sketches: [] });
  useSelectionStore.getState().clear();
});

function toolbar() {
  return render(<ContextToolbar
    onHole={vi.fn()}
    onDressUp={vi.fn()}
    onSketch={vi.fn()}
    onExtrude={vi.fn()}
    onEditSketch={vi.fn()}
    onInstance={vi.fn()}
    onOpenProps={vi.fn()}
  />);
}

it("offers Sketch here for one healthy datum plane and hides solid-only actions", () => {
  const plane = DatumDescriptorSchema.parse({ featureId: "native-plane", kind: "DatumPlane",
    definition: { type: "principal", planeKind: "XY" }, dependsOn: [],
    resolved: { originMm: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] }, status: "ok" });
  useDocumentUiStore.getState().setCoreStatus(true, "test");
  useDocumentUiStore.setState({ datums: [plane] });
  useSelectionStore.getState().select(plane.featureId, false);
  toolbar();
  expect((screen.getByRole("button", { name: t("ctx.sketchHere") }) as HTMLButtonElement).disabled).toBe(false);
  for (const key of ["ctx.hole", "ctx.round", "ctx.corner", "ctx.copyPlaced", "ctx.combine", "ctx.subtract", "ctx.overlap"])
    expect(screen.queryByText(t(key as Parameters<typeof t>[0]))).toBeNull();
});

it("offers no sketch or solid command for axes, points, broken planes, or multiple planes", () => {
  const plane = DatumDescriptorSchema.parse({ featureId: "native-plane", kind: "DatumPlane",
    definition: { type: "principal", planeKind: "XY" }, dependsOn: [],
    resolved: { originMm: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] }, status: "ok" });
  const axis = DatumDescriptorSchema.parse({ featureId: "native-axis", kind: "DatumAxis",
    definition: { type: "planeNormal", plane: { type: "principal", planeKind: "XY" } }, dependsOn: [],
    resolved: { originMm: [0, 0, 0], direction: [0, 0, 1] }, status: "ok" });
  const point = DatumDescriptorSchema.parse({ featureId: "native-point", kind: "DatumPoint",
    definition: { type: "coordinates", positionMm: [1, 2, 3] }, dependsOn: [],
    resolved: { positionMm: [1, 2, 3] }, status: "ok" });
  useDocumentUiStore.getState().setCoreStatus(true, "test");
  for (const [datums, ids] of [
    [[axis], [axis.featureId]],
    [[point], [point.featureId]],
    [[{ ...plane, status: "broken" }], [plane.featureId]],
    [[plane, { ...plane, featureId: "second-plane" }], [plane.featureId, "second-plane"]],
  ] as const) {
    cleanup();
    useDocumentUiStore.setState({ datums: [...datums] });
    useSelectionStore.setState({ selectedIds: [...ids] });
    toolbar();
    expect(screen.queryByRole("toolbar")).toBeNull();
  }
});
