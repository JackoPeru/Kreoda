import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SessionConnectionPanel } from "../src/components/workspace/SessionConnectionPanel";
import type { SessionConnectionStatus } from "../electron/session-control-ui";
import { setLocale } from "../src/i18n";

afterEach(() => { cleanup();vi.unstubAllGlobals(); });

it("enables the selected interface, pairs explicitly and revokes a connected device", async () => {
  setLocale("en");
  let status: SessionConnectionStatus = {
    session: { sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", documentId: "doc-phase1", documentRevision: 0, connectedClients: [], transactionState: null },
    listener: null, interfaces: [{ name: "Local", host: "127.0.0.1" }, { name: "Wi-Fi", host: "192.168.1.10" }],
    clients: [], transaction: null, devices: [], pairingAvailable: true,
  };
  const sessionEnable = vi.fn(async (host: string, port: number) => {
    status = { ...status, listener: { host, port }, devices: [{ deviceId: "device-test", name: "Laptop", pairedAt: new Date().toISOString() }],
      clients: [{ deviceId: "device-test", name: "Laptop", clientType: "test", capabilities: [] }] };return status;
  });
  const sessionPair = vi.fn(async () => ({ token: "p".repeat(43), code: "00123456", expiresAt: new Date(Date.now() + 300000).toISOString() }));
  const sessionCancelPair = vi.fn(async () => {});
  const sessionRevoke = vi.fn(async () => { status = { ...status, clients: [], devices: [] };return status; });
  Object.defineProperty(window, "kreoda", { configurable: true, value: {
    sessionConnectionStatus: vi.fn(async () => status), sessionEnable, sessionPair, sessionCancelPair, sessionRevoke,
  } });
  const view = render(<SessionConnectionPanel onClose={vi.fn()} />);
  await waitFor(() => expect((screen.getByRole("button", { name: "Enable connections" }) as HTMLButtonElement).disabled).toBe(false));
  expect(sessionPair).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "192.168.1.10" } });
  fireEvent.click(screen.getByRole("button", { name: "Enable connections" }));
  await screen.findByDisplayValue("ws://192.168.1.10:9860");
  expect(sessionEnable).toHaveBeenCalledWith("192.168.1.10", 9860);
  fireEvent.click(screen.getByRole("button", { name: "Pair a device" }));
  await screen.findByDisplayValue("0012 3456");
  expect((screen.getByLabelText("Pairing code") as HTMLInputElement).value).toBe("0012 3456");
  expect((screen.getByLabelText("Legacy pairing token") as HTMLInputElement).value).toBe("p".repeat(43));
  expect(sessionPair).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
  await screen.findByText("No paired devices");
  expect(sessionRevoke).toHaveBeenCalledWith("device-test");
  view.unmount();expect(sessionCancelPair).toHaveBeenCalledOnce();
});
