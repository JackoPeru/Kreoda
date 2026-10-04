import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { SessionDevices } from "../electron/session-devices";
import { SessionRelay } from "../electron/session";
import type { SidecarManager } from "../electron/sidecar";

async function boot(run: (relay: SessionRelay, devices: SessionDevices, calls: number[], socket: () => Promise<ReturnType<typeof client>>) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "kreoda-pairing-test-"));
  const sockets: WebSocket[] = [];const calls: number[] = [];
  const devices = new SessionDevices(root);await devices.load();
  const fake = { invoke: async (bytes: Uint8Array) => {
    const request = JSON.parse(Buffer.from(bytes).subarray(4).toString());calls.push(request.type);
    return Buffer.from(JSON.stringify({ requestId: request.requestId, status: "ok", revision: 0, features: [], sketches: [] }));
  } } as unknown as SidecarManager;
  const relay = new SessionRelay(() => fake, undefined, devices);
  try {
    await relay.enableListener({ host: "127.0.0.1", port: 0 });
    const server = (relay as unknown as { server: WebSocketServer }).server;
    if (!server.address()) await new Promise<void>(ready => server.once("listening", ready));
    const address = server.address();if (!address || typeof address === "string") throw new Error("missing listener");
    await run(relay, devices, calls, async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}`);sockets.push(ws);
      await new Promise<void>((ready, failed) => { ws.once("open", ready);ws.once("error", failed); });
      return client(ws);
    });
  } finally {
    for (const ws of sockets) ws.terminate();relay.stop();
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("kreoda-pairing-test-")) throw new Error("invalid cleanup target");
    await rm(root, { recursive: true, force: true });
  }
}
function client(ws: WebSocket) {
  let seq = 0;
  return {
    ws,
    call: (method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> => new Promise((ready, failed) => {
      const requestId = `pair-${++seq}`;
      const timeout = setTimeout(() => { ws.off("message", received);failed(new Error("pairing reply timed out")); }, 3000);
      const received = (bytes: unknown): void => {
        const result = JSON.parse(String(bytes)) as Record<string, unknown>;
        if (result["requestId"] === requestId) { clearTimeout(timeout);ws.off("message", received);ready(result); }
      };
      ws.on("message", received);ws.send(JSON.stringify({ requestId, method, params }));
    }),
  };
}

describe("trusted device WebSocket gate", () => {
  it("disabling transport preserves local lineage and rotates device tokens", async () => {
    await boot(async (relay, devices, _calls, socket) => {
      const snapshot = await relay.localSnapshot();
      const c = await socket();
      const paired = await c.call("pair", { pairingToken: devices.beginPairing().token, deviceName: "Laptop" });
      await c.call("hello", { protocolVersion: 1, deviceId: paired["deviceId"], token: paired["sessionToken"] });
      await relay.disableListener();
      expect(relay.connectionStatus().listener).toBeNull();
      expect(devices.authorize(paired["deviceId"] as string, paired["sessionToken"] as string)).toBe(false);
      expect((await relay.localSnapshot()).sessionId).toBe(snapshot.sessionId);
      await relay.enableListener({ host: "127.0.0.1", port: 0 });
      expect((await relay.localSnapshot()).sessionId).toBe(snapshot.sessionId);
      expect(devices.authenticate(paired["deviceId"] as string, paired["credential"] as string).sessionToken).not.toBe(paired["sessionToken"]);
    });
  });

  it("reports occupied ports and can enable a listener after failure", async () => {
    await boot(async relay => {
      await relay.disableListener();
      const occupied = createServer();
      await new Promise<void>(ready => occupied.listen(0, "127.0.0.1", ready));
      const address = occupied.address();if (!address || typeof address === "string") throw new Error("missing test port");
      try {
        await expect(relay.enableListener({ host: "127.0.0.1", port: address.port })).rejects.toMatchObject({ code: "LISTENER_FAILED" });
        expect(relay.connectionStatus().listener).toBeNull();
      } finally { await new Promise<void>(ready => occupied.close(() => ready())); }
      await relay.enableListener({ host: "127.0.0.1", port: address.port });
      expect(relay.connectionStatus().listener?.port).toBe(address.port);
    });
  });

  it("exchanges one-use pairing, authenticates a device and requires hello before CAD access", async () => {
    await boot(async (relay, devices, calls, socket) => {
      const c = await socket();
      expect((await c.call("snapshot"))["errorCode"]).toBe("NOT_AUTHED");
      const token = devices.beginPairing().token;
      const paired = await c.call("pair", { pairingToken: token, deviceName: "Quest" });
      expect(paired["ok"]).toBe(true);
      expect(relay.clientCount).toBe(0);expect(calls).toHaveLength(0);
      expect((await c.call("pair", { pairingToken: token, deviceName: "again" }))["errorCode"]).toBe("UNAUTHORIZED");
      const auth = await c.call("authenticate", { deviceId: paired["deviceId"], credential: paired["credential"] });
      expect(auth["ok"]).toBe(true);expect(relay.clientCount).toBe(0);expect(calls).toHaveLength(0);
      const hello = await c.call("hello", { protocolVersion: 1, deviceId: paired["deviceId"], token: auth["sessionToken"], clientId: `client-${randomUUID()}` });
      expect(hello["ok"]).toBe(true);expect(relay.clientCount).toBe(1);
      expect((await c.call("snapshot"))["ok"]).toBe(true);
    });
  });

  it("revocation closes connected sockets and rejects the stored credential", async () => {
    await boot(async (relay, devices, _calls, socket) => {
      const c = await socket();
      const paired = await c.call("pair", { pairingToken: devices.beginPairing().token, deviceName: "Laptop" });
      expect(paired["ok"]).toBe(true);
      await c.call("hello", { protocolVersion: 1, deviceId: paired["deviceId"], token: paired["sessionToken"] });
      const closed = new Promise<number>(ready => c.ws.once("close", code => ready(code)));
      await relay.revokeDevice(paired["deviceId"] as string);
      expect(await closed).toBe(4403);
      const other = await socket();
      expect((await other.call("authenticate", { deviceId: paired["deviceId"], credential: paired["credential"] }))["errorCode"]).toBe("UNAUTHORIZED");
      expect(devices.list()).toHaveLength(0);
    });
  });

  it("rejects arbitrary public/wildcard listener hosts before binding", async () => {
    const fake = {} as SidecarManager;const relay = new SessionRelay(() => fake);
    try {
      for (const host of ["0.0.0.0", "::", "8.8.8.8", "not-a-local-host"]) {
        expect(() => relay.start({ host, port: 0, token: "explicit-unit-bootstrap" })).toThrow();
      }
    } finally { relay.stop(); }
  });
});
