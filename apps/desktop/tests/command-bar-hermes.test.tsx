import { act, fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { CommandBar } from "../src/components/CommandBar";
import { useDocumentUiStore, useSelectionStore, usePreferencesStore } from "../src/stores";
import { useSharedTargetStore } from "../src/model/shared-targets";
import { setLocale } from "../src/i18n";
import type { KreodaApi } from "../electron/preload";

const sessionId = "a3dc49de-24bf-4b91-b356-54cc2dd06741";
const snapshot = () => ({ sessionId, documentId: "doc-phase1", revision: 0, features: [], bodies: [], sketches: [] });
const status = vi.fn();
const turn = vi.fn();
const cancel = vi.fn();
function enter(text?: string) {
  const input = screen.getByTestId("command-input");
  if (text !== undefined) fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("Direct provider forbidden")))); setLocale("en");
  useDocumentUiStore.setState({ documentId: "doc-phase1", revision: 0, epoch: 1, connectionGeneration: 1, coreRunning: true, features: [], sketches: [], datums: [], bodies: [], meshes: {} });
  useSelectionStore.setState({ selectedIds: [] }); useSharedTargetStore.getState().reset();
  usePreferencesStore.setState({ llmEndpoint: "http://legacy.invalid", llmModel: "legacy" });
  status.mockResolvedValue({ ok: true, result: { ...snapshot(), configured: true, reachable: true } });
  turn.mockImplementation(async request => ({ ok: true, result: { sessionId, documentId: request.documentId, voiceRequestId: request.voiceRequestId, revision: 1, reply: { text: "Actual Hermes reply <b>safe</b>", runId: "run-1" } } }));
  cancel.mockResolvedValue({ ok: true, result: { sessionId, documentId: "doc-phase1", revision: 0, voiceRequestId: "unused", status: "cancelRequested" } });
  window.kreoda = { sessionSnapshot: vi.fn(async () => snapshot()), agentStatus: status, agentTurn: turn, agentCancel: cancel } as unknown as KreodaApi;
});
afterEach(() => { cleanup(); setLocale("en"); vi.unstubAllGlobals(); });
describe("CommandBar contextual Hermes", () => {
  it("reviews NL without a turn; explicit Send submits once and shows actual escaped reply", async () => {
    render(<CommandBar />); enter("make me a bracket with four holes");
    await screen.findByTestId("hermes-review"); expect(turn).not.toHaveBeenCalled();
    const send = screen.getByTestId("hermes-send"); fireEvent.click(send); fireEvent.click(send);
    await screen.findByText("Actual Hermes reply <b>safe</b>");
    expect(turn).toHaveBeenCalledTimes(1); expect(document.querySelector("b")).toBeNull();
    expect(turn.mock.calls[0]![0].context).toMatchObject({ sessionId, source: "desktop", project: "Kreoda", units: "mm", selectionIds: [] });
  });
  it.each([[false, true], [true, false]])("requires configured=%s and reachable=%s together", async (configured, reachable) => {
    status.mockResolvedValue({ ok: true, result: { ...snapshot(), configured, reachable } });
    render(<CommandBar />); enter("make me a bracket with four holes");
    await screen.findByRole("alert");
    expect(screen.queryByTestId("hermes-send")).toBeNull(); expect(turn).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("local syntax and help bypass agent status and endpoint", () => {
    render(<CommandBar />); enter("box 100 50 20"); expect(screen.getByTestId("plan-preview")).toBeTruthy();
    enter("help"); expect(status).not.toHaveBeenCalled(); expect(turn).not.toHaveBeenCalled();
  });
  it("ignores late preparation after editing without leaving the bar busy", async () => {
    const pending = deferred<Awaited<ReturnType<KreodaApi["agentStatus"]>>>(); status.mockReturnValueOnce(pending.promise);
    render(<CommandBar />); enter("make me a bracket with four holes"); await waitFor(() => expect(status).toHaveBeenCalled());
    fireEvent.change(screen.getByTestId("command-input"), { target: { value: "box 1 2 3" } });
    await act(async () => pending.resolve({ ok: true, result: { ...snapshot(), configured: true, reachable: true } }));
    expect(screen.queryByTestId("hermes-review")).toBeNull(); enter(); expect(screen.getByTestId("plan-preview")).toBeTruthy(); expect(turn).not.toHaveBeenCalled();
  });
  it("invalidates prepared request on selection/context/locale changes", async () => {
    render(<CommandBar />); enter("make me a bracket with four holes"); await screen.findByTestId("hermes-review");
    act(() => useSelectionStore.setState({ selectedIds: ["unknown"] }));
    expect(screen.queryByTestId("hermes-review")).toBeNull(); expect(turn).not.toHaveBeenCalled();
  });
  it.each(["revision", "epoch", "connectionGeneration", "documentId", "locale"])("invalidates prepared review after %s changes", async key => {
    render(<CommandBar />); enter("make me a bracket with four holes"); await screen.findByTestId("hermes-review");
    act(() => { if (key === "locale") setLocale("it"); else useDocumentUiStore.setState(key === "documentId" ? { documentId: "other" } : { [key]: 9 }); });
    expect(screen.queryByTestId("hermes-review")).toBeNull(); expect(turn).not.toHaveBeenCalled();
  });
  it("fresh session mismatch before Send rejects without executing", async () => {
    render(<CommandBar />); enter("make me a bracket with four holes"); await screen.findByTestId("hermes-review");
    window.kreoda.sessionSnapshot = vi.fn(async () => ({ ...snapshot(), sessionId: "54a0b2a4-3815-4f23-9a4a-25b242e9a151" })); enter();
    await screen.findByRole("alert"); expect(turn).not.toHaveBeenCalled();
  });
  it("rejects a reply for another flow and does not retry", async () => {
    turn.mockResolvedValueOnce({ ok: true, result: { ...snapshot(), voiceRequestId: "different", reply: { text: "wrong reply", runId: "run-x" } } });
    render(<CommandBar />); enter("make me a bracket with four holes"); await screen.findByTestId("hermes-review"); enter();
    await screen.findByRole("alert"); expect(screen.queryByText("wrong reply")).toBeNull(); expect(turn).toHaveBeenCalledTimes(1);
  });
  it("a late cancel result cannot change the next request", async () => {
    const pending = deferred<Awaited<ReturnType<KreodaApi["agentTurn"]>>>();
    const cancelPending = deferred<Awaited<ReturnType<KreodaApi["agentCancel"]>>>();
    turn.mockReturnValueOnce(pending.promise); cancel.mockReturnValueOnce(cancelPending.promise);
    render(<CommandBar />); enter("make me a bracket with four holes"); await screen.findByTestId("hermes-review"); enter();
    await waitFor(() => expect(turn).toHaveBeenCalledTimes(1)); fireEvent.click(screen.getByTestId("hermes-stop"));
    const request = turn.mock.calls[0]![0];
    await act(async () => pending.resolve({ ok: true, result: { sessionId, documentId: request.documentId, voiceRequestId: request.voiceRequestId, revision: 0, reply: { text: "first done", runId: "run-first" } } }));
    enter("make a different bracket"); await screen.findByTestId("hermes-review");
    await act(async () => cancelPending.resolve({ ok: false, error: { code: "VOICE_FAILED", message: "Voice bridge request failed" } }));
    expect(screen.queryByRole("alert")).toBeNull(); expect(screen.getByTestId("hermes-review").textContent).toContain("different bracket");
  });
  it("Stop owns exact running flow, keeps busy until turn settles, preserves a new draft", async () => {
    const pending = deferred<Awaited<ReturnType<KreodaApi["agentTurn"]>>>(); turn.mockReturnValueOnce(pending.promise);
    render(<CommandBar />); enter("make me a bracket with four holes"); await screen.findByTestId("hermes-review"); enter();
    await waitFor(() => expect(turn).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByTestId("command-input"), { target: { value: "new draft" } });
    fireEvent.keyDown(screen.getByTestId("command-input"), { key: "Escape" });
    const request = turn.mock.calls[0]![0]; expect(cancel).toHaveBeenCalledWith(sessionId, { documentId: request.documentId, voiceRequestId: request.voiceRequestId });
    enter(); expect(turn).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ ok: false, error: { code: "ROLLBACK_UNCONFIRMED", message: "CAD recovery status is uncertain", status: "uncertain", runId: "run-uncertain", recoveryPersisted: true } }));
    expect((screen.getByTestId("command-input") as HTMLInputElement).value).toBe("new draft");
    expect(screen.getByRole("alert").textContent).toMatch(/recovery|Recovery/); expect(screen.getByRole("alert").textContent).toContain("run-uncertain");
  });
  it("unmount cancels only an owned active turn and catches rejection", async () => {
    const pending = deferred<Awaited<ReturnType<KreodaApi["agentTurn"]>>>(); turn.mockReturnValueOnce(pending.promise); cancel.mockRejectedValueOnce(new Error("offline"));
    const view = render(<CommandBar />); enter("make me a bracket with four holes"); await screen.findByTestId("hermes-review"); enter();
    await waitFor(() => expect(turn).toHaveBeenCalledTimes(1)); view.unmount(); await act(async () => { await Promise.resolve(); }); expect(cancel).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ ok: false, error: { code: "CANCELLED", message: "Voice request was cancelled" } }));
  });
});
