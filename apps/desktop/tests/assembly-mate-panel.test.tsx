import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useDocumentUiStore, useSelectionStore } from "../src/stores";

const mocks = vi.hoisted(() => ({
  core: {
    documentId: "doc-mates",
    captureAssemblyMateContext: vi.fn(),
    captureAssemblyGeometrySelection: vi.fn(),
    defineAssemblyConstraint: vi.fn(),
    requestSnapshot: vi.fn(),
  },
  sync: vi.fn(),
}));
vi.mock("../src/ipc/coreClient", () => ({ coreClient: mocks.core }));
vi.mock("../src/model/sync", () => ({ syncFromCoreList: mocks.sync }));
import { AssemblyMatePanel } from "../src/components/workspace/AssemblyMatePanel";

const sourceBinding = { type: "face", featureId: "part-a", persistentFaceId: "box.+Z", geometryKind: "plane" };
const capture = (persistentId: string, featureId: string, geometryKind: "plane" | "line" | "circle" | "cylinder" = "plane") => ({
  persistentId,
  captureRevision: 4,
  sourceBinding: { ...sourceBinding, featureId, geometryKind },
});

function seed() {
  const store = useDocumentUiStore.getState();
  store.resetDocument("doc-mates");
  store.setCoreStatus(true);
  store.setFeatures([
    { featureId: "part-a", type: "Box", paramsMm: [], dependsOn: [], refExtra: "", expressions: {} },
    { featureId: "part-b", type: "Cylinder", paramsMm: [], dependsOn: [], refExtra: "", expressions: {} },
    { featureId: "instance-a", type: "Instance", paramsMm: [], dependsOn: ["part-a"], refExtra: "", expressions: {} },
    { featureId: "instance-b", type: "Instance", paramsMm: [], dependsOn: ["part-b"], refExtra: "", expressions: {} },
  ], 4);
  useSelectionStore.setState({ selectedIds: ["instance-a:box.+Z"] });
  const current = useDocumentUiStore.getState();
  mocks.core.captureAssemblyMateContext.mockImplementation(async () => ({
    documentId: "doc-mates", revision: 4, epoch: current.epoch,
    connectionGeneration: current.connectionGeneration, meshRevision: current.meshRevision,
    sessionId: "550e8400-e29b-41d4-a716-446655440000",
  }));
  mocks.core.captureAssemblyGeometrySelection.mockImplementation(async (instanceId: string, pickId: string) =>
    capture(pickId, instanceId === "instance-a" ? "part-a" : "part-b"));
  mocks.core.defineAssemblyConstraint.mockResolvedValue({ revision: 5 });
  mocks.core.requestSnapshot.mockResolvedValue({ features: current.features, sketches: [], datums: [], revision: 5 });
}

beforeEach(() => {
  seed();
  Object.defineProperty(window, "kreoda", { configurable: true, value: {
    sessionSnapshot: vi.fn(async () => ({ sessionId: "550e8400-e29b-41d4-a716-446655440000",
      documentId: "doc-mates", revision: 5 })),
  } });
  mocks.core.captureAssemblyMateContext.mockClear();
  mocks.core.captureAssemblyGeometrySelection.mockClear();
  mocks.core.defineAssemblyConstraint.mockClear();
  mocks.sync.mockClear();
});
afterEach(() => { cleanup(); Reflect.deleteProperty(window, "kreoda"); });

describe("AssemblyMatePanel", () => {
  it("captures exact face picks for both instances and submits the registry-backed mate without exposing IDs", async () => {
    const { container } = render(<AssemblyMatePanel />);
    expect(screen.getByLabelText("Istanza da vincolare").textContent).toContain("Istanza 1 · Box");
    expect(container.textContent).not.toContain("instance-a");
    expect(container.textContent).not.toContain("instance-b");
    fireEvent.change(screen.getByLabelText("Tipo vincolo"), { target: { value: "parallel" } });
    fireEvent.change(screen.getByLabelText("Istanza da vincolare"), { target: { value: "instance-a" } });
    fireEvent.change(screen.getByLabelText("Istanza fissata"), { target: { value: "instance-b" } });

    useSelectionStore.setState({ selectedIds: ["instance-a:box.+Z"] });
    fireEvent.click(screen.getByRole("button", { name: "Acquisisci geometria mobile" }));
    await waitFor(() => expect(screen.getByText(/Mobile:.*piano/i)).toBeTruthy());
    useSelectionStore.setState({ selectedIds: ["instance-b:box.+Z"] });
    fireEvent.click(screen.getByRole("button", { name: "Acquisisci geometria fissa" }));
    await waitFor(() => expect(screen.getByText(/Fissa:.*piano/i)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Crea accoppiamento" }));
    await waitFor(() => expect(mocks.core.defineAssemblyConstraint).toHaveBeenCalledTimes(1));
    expect(mocks.core.captureAssemblyGeometrySelection).toHaveBeenNthCalledWith(
      1, "instance-a", "instance-a:box.+Z", expect.anything());
    expect(mocks.core.captureAssemblyGeometrySelection).toHaveBeenNthCalledWith(
      2, "instance-b", "instance-b:box.+Z", expect.anything());
    expect(mocks.core.defineAssemblyConstraint.mock.calls[0]![0]).toMatchObject({
      kind: "parallel", movingId: "instance-a", fixedId: "instance-b", captureRevision: 4,
      movingPickId: "instance-a:box.+Z", fixedPickId: "instance-b:box.+Z",
      movingSourceBinding: { ...sourceBinding, featureId: "part-a" },
      fixedSourceBinding: { ...sourceBinding, featureId: "part-b" },
    });
    expect(mocks.sync).toHaveBeenCalled();
  });

  it("does not install a stale selection response or let an older finally clear newer work", async () => {
    const { container } = render(<AssemblyMatePanel />);
    fireEvent.change(screen.getByLabelText("Tipo vincolo"), { target: { value: "parallel" } });
    fireEvent.change(screen.getByLabelText("Istanza da vincolare"), { target: { value: "instance-a" } });
    fireEvent.change(screen.getByLabelText("Istanza fissata"), { target: { value: "instance-b" } });
    let releaseMoving!: (value: ReturnType<typeof capture>) => void;
    let releaseFixed!: (value: ReturnType<typeof capture>) => void;
    mocks.core.captureAssemblyGeometrySelection
      .mockImplementationOnce(() => new Promise(resolve => { releaseMoving = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { releaseFixed = resolve; }));
    useSelectionStore.setState({ selectedIds: ["instance-a:box.+Z"] });
    fireEvent.click(screen.getByRole("button", { name: "Acquisisci geometria mobile" }));
    await waitFor(() => expect(releaseMoving).toBeTypeOf("function"));
    useSelectionStore.setState({ selectedIds: ["instance-b:box.+Z"] });
    fireEvent.click(screen.getByRole("button", { name: "Acquisisci geometria fissa" }));
    await waitFor(() => expect(releaseFixed).toBeTypeOf("function"));

    releaseMoving(capture("instance-a:box.+Z", "part-a"));
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(container.textContent).not.toContain("Mobile: piano");
    releaseFixed(capture("instance-b:box.+Z", "part-b"));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(container.textContent).toContain("Fissa: piano");
  });

  it("reports blank and non-finite numeric values and accepts parsed millimetre decimals", () => {
    render(<AssemblyMatePanel />);
    fireEvent.change(screen.getByLabelText("Tipo vincolo"), { target: { value: "distance" } });
    fireEvent.change(screen.getByLabelText("Istanza da vincolare"), { target: { value: "instance-a" } });
    fireEvent.change(screen.getByLabelText("Istanza fissata"), { target: { value: "instance-b" } });
    fireEvent.change(screen.getByLabelText("Distanza mm"), { target: { value: "   " } });
    expect(screen.getByRole("alert").textContent).toMatch(/distanza/i);
    fireEvent.change(screen.getByLabelText("Distanza mm"), { target: { value: "Infinity" } });
    expect(screen.getByRole("alert").textContent).toMatch(/valida|finita/i);
    fireEvent.change(screen.getByLabelText("Distanza mm"), { target: { value: "2.5 mm" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect((screen.getByRole("button", { name: "Crea accoppiamento" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.change(screen.getByLabelText("Tipo vincolo"), { target: { value: "angle" } });
    expect((screen.getByLabelText("Angolo gradi") as HTMLInputElement).value).toBe("0°");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(screen.getByLabelText("Angolo gradi"), { target: { value: "" } });
    expect(screen.getByRole("alert").textContent).toMatch(/angolo/i);
    fireEvent.change(screen.getByLabelText("Angolo gradi"), { target: { value: "Infinity" } });
    expect(screen.getByRole("alert").textContent).toMatch(/valido|finito/i);
    fireEvent.change(screen.getByLabelText("Angolo gradi"), { target: { value: "181" } });
    expect(screen.getByRole("alert").textContent).toMatch(/180/i);
    expect((screen.getByRole("button", { name: "Crea accoppiamento" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Angolo gradi"), { target: { value: "30.5" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("submits signed origin distance without changing its sign", async () => {
    render(<AssemblyMatePanel />);
    fireEvent.change(screen.getByLabelText("Tipo vincolo"), { target: { value: "distance" } });
    fireEvent.change(screen.getByLabelText("Istanza da vincolare"), { target: { value: "instance-a" } });
    fireEvent.change(screen.getByLabelText("Istanza fissata"), { target: { value: "instance-b" } });
    fireEvent.change(screen.getByLabelText("Distanza mm"), { target: { value: "-12.5 mm" } });
    fireEvent.click(screen.getByRole("button", { name: "Crea accoppiamento" }));
    await waitFor(() => expect(mocks.core.defineAssemblyConstraint).toHaveBeenCalledTimes(1));
    expect(mocks.core.defineAssemblyConstraint.mock.calls[0]![0]).toMatchObject({
      kind: "distance", movingId: "instance-a", fixedId: "instance-b", axis: 0, distanceMm: -12.5,
    });
  });

  it("submits each registered mate kind with only its applicable fields", async () => {
    const cases = [
      { kind: "ground", fixed: false, expected: { kind: "ground", movingId: "instance-a" } },
      { kind: "coincident", expected: { kind: "coincident", movingId: "instance-a", fixedId: "instance-b" } },
      { kind: "distance", expected: { kind: "distance", movingId: "instance-a", fixedId: "instance-b", axis: 2, distanceMm: -12.5 } },
      { kind: "parallel", geometry: "plane" as const, expected: { kind: "parallel", movingId: "instance-a", fixedId: "instance-b", captureRevision: 4 } },
      { kind: "perpendicular", geometry: "plane" as const, expected: { kind: "perpendicular", movingId: "instance-a", fixedId: "instance-b", captureRevision: 4 } },
      { kind: "concentric", geometry: "cylinder" as const, expected: { kind: "concentric", movingId: "instance-a", fixedId: "instance-b", captureRevision: 4 } },
      { kind: "angle", geometry: "plane" as const, expected: { kind: "angle", movingId: "instance-a", fixedId: "instance-b", captureRevision: 4, angleDeg: 30.5 } },
    ] as const;

    for (const testCase of cases) {
      cleanup();
      seed();
      mocks.core.captureAssemblyGeometrySelection.mockClear();
      mocks.core.defineAssemblyConstraint.mockClear();
      mocks.sync.mockClear();
      render(<AssemblyMatePanel />);
      fireEvent.change(screen.getByLabelText("Tipo vincolo"), { target: { value: testCase.kind } });
      fireEvent.change(screen.getByLabelText("Istanza da vincolare"), { target: { value: "instance-a" } });
      if (testCase.kind !== "ground")
        fireEvent.change(screen.getByLabelText("Istanza fissata"), { target: { value: "instance-b" } });

      if ("geometry" in testCase) {
        mocks.core.captureAssemblyGeometrySelection.mockImplementation(async (instanceId: string, pickId: string) =>
          capture(pickId, instanceId === "instance-a" ? "part-a" : "part-b", testCase.geometry));
        useSelectionStore.setState({ selectedIds: ["instance-a:box.+Z"] });
        fireEvent.click(screen.getByRole("button", { name: "Acquisisci geometria mobile" }));
        await waitFor(() => expect(screen.getByText(/Mobile:/)).toBeTruthy());
        useSelectionStore.setState({ selectedIds: ["instance-b:box.+Z"] });
        fireEvent.click(screen.getByRole("button", { name: "Acquisisci geometria fissa" }));
        await waitFor(() => expect(screen.getByText(/Fissa:/)).toBeTruthy());
      }
      if (testCase.kind === "distance") {
        fireEvent.change(screen.getByLabelText("Asse distanza"), { target: { value: "2" } });
        fireEvent.change(screen.getByLabelText("Distanza mm"), { target: { value: "-12.5 mm" } });
      }
      if (testCase.kind === "angle")
        fireEvent.change(screen.getByLabelText("Angolo gradi"), { target: { value: "30.5°" } });

      fireEvent.click(screen.getByRole("button", { name: "Crea accoppiamento" }));
      await waitFor(() => expect(mocks.core.defineAssemblyConstraint).toHaveBeenCalledTimes(1));
      const payload = mocks.core.defineAssemblyConstraint.mock.calls[0]![0] as Record<string, unknown>;
      expect(payload).toMatchObject(testCase.expected);
      if ("geometry" in testCase) {
        expect(payload).toMatchObject({
          movingPickId: "instance-a:box.+Z", fixedPickId: "instance-b:box.+Z",
          movingSourceBinding: { ...sourceBinding, featureId: "part-a", geometryKind: testCase.geometry },
          fixedSourceBinding: { ...sourceBinding, featureId: "part-b", geometryKind: testCase.geometry },
        });
      } else {
        expect(payload).not.toHaveProperty("captureRevision");
        expect(payload).not.toHaveProperty("movingSourceBinding");
      }
      if (testCase.kind !== "angle") expect(payload).not.toHaveProperty("angleDeg");
      if (testCase.kind !== "distance") expect(payload).not.toHaveProperty("distanceMm");
      if (testCase.kind === "ground") expect(payload).not.toHaveProperty("fixedId");
    }
  });

  it("invalidates pending capture when slot owner changes", async () => {
    const { container } = render(<AssemblyMatePanel />);
    fireEvent.change(screen.getByLabelText("Tipo vincolo"), { target: { value: "parallel" } });
    fireEvent.change(screen.getByLabelText("Istanza da vincolare"), { target: { value: "instance-a" } });
    fireEvent.change(screen.getByLabelText("Istanza fissata"), { target: { value: "instance-b" } });
    let release!: (value: ReturnType<typeof capture>) => void;
    mocks.core.captureAssemblyGeometrySelection.mockImplementationOnce(() =>
      new Promise(resolve => { release = resolve; }));
    useSelectionStore.setState({ selectedIds: ["instance-a:box.+Z"] });
    fireEvent.click(screen.getByRole("button", { name: "Acquisisci geometria mobile" }));
    await waitFor(() => expect(release).toBeTypeOf("function"));
    fireEvent.change(screen.getByLabelText("Istanza da vincolare"), { target: { value: "instance-b" } });
    release(capture("instance-a:box.+Z", "part-a"));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(container.textContent).not.toContain("Mobile: piano");
  });

  it("clears only the recaptured slot when its replacement geometry is rejected", async () => {
    const { container } = render(<AssemblyMatePanel />);
    fireEvent.change(screen.getByLabelText("Tipo vincolo"), { target: { value: "parallel" } });
    fireEvent.change(screen.getByLabelText("Istanza da vincolare"), { target: { value: "instance-a" } });
    fireEvent.change(screen.getByLabelText("Istanza fissata"), { target: { value: "instance-b" } });
    useSelectionStore.setState({ selectedIds: ["instance-a:box.+Z"] });
    fireEvent.click(screen.getByRole("button", { name: "Acquisisci geometria mobile" }));
    await waitFor(() => expect(screen.getByText(/Mobile:.*piano/i)).toBeTruthy());
    useSelectionStore.setState({ selectedIds: ["instance-b:box.+Z"] });
    fireEvent.click(screen.getByRole("button", { name: "Acquisisci geometria fissa" }));
    await waitFor(() => expect(screen.getByText(/Fissa:.*piano/i)).toBeTruthy());

    mocks.core.captureAssemblyGeometrySelection.mockRejectedValueOnce(new Error("geometria non supportata"));
    useSelectionStore.setState({ selectedIds: ["instance-a:box.-Z"] });
    fireEvent.click(screen.getByRole("button", { name: "Acquisisci geometria mobile" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("geometria non supportata"));

    expect(container.textContent).not.toContain("Mobile: piano");
    expect(container.textContent).toContain("Fissa: piano");
    expect((screen.getByRole("button", { name: "Crea accoppiamento" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.core.defineAssemblyConstraint).not.toHaveBeenCalled();
  });

  it("blocks concentric relation for planes and protects sync hydration after document replacement", async () => {
    const { container } = render(<AssemblyMatePanel />);
    fireEvent.change(screen.getByLabelText("Tipo vincolo"), { target: { value: "concentric" } });
    fireEvent.change(screen.getByLabelText("Istanza da vincolare"), { target: { value: "instance-a" } });
    fireEvent.change(screen.getByLabelText("Istanza fissata"), { target: { value: "instance-b" } });
    useSelectionStore.setState({ selectedIds: ["instance-a:box.+Z"] });
    fireEvent.click(screen.getByRole("button", { name: "Acquisisci geometria mobile" }));
    await waitFor(() => expect(screen.getByText(/Mobile:.*piano/i)).toBeTruthy());
    useSelectionStore.setState({ selectedIds: ["instance-b:box.+Z"] });
    fireEvent.click(screen.getByRole("button", { name: "Acquisisci geometria fissa" }));
    await waitFor(() => expect(screen.getByText(/Fissa:.*piano/i)).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/cilindriche|circolari/i);
    expect((screen.getByRole("button", { name: "Crea accoppiamento" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.core.defineAssemblyConstraint).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Tipo vincolo"), { target: { value: "distance" } });
    let releaseSync!: () => void;
    let syncGuard: (() => boolean) | undefined;
    const syncPending = new Promise<void>(resolve => { releaseSync = resolve; });
    mocks.sync.mockImplementationOnce(async (...args) => {
      syncGuard = args[5] as (() => boolean);
      await syncPending;
      if (!syncGuard()) throw new Error("stale surface sync");
    });
    fireEvent.click(screen.getByRole("button", { name: "Crea accoppiamento" }));
    await waitFor(() => expect(syncGuard).toBeTypeOf("function"));
    act(() => { useDocumentUiStore.getState().resetDocument("doc-replaced"); });
    expect(syncGuard!()).toBe(false);
    await act(async () => { releaseSync(); });
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(container.textContent).not.toContain("stale surface sync");
  });
});
