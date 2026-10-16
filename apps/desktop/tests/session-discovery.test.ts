import { describe, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { createSocket } from "node:dgram";
import { SessionDevices } from "../electron/session-devices";
import { SessionDiscovery, AutomaticSessionHost, privatePeer } from "../electron/session-discovery";

describe("automatic local pairing", () => {
  it("owns interface changes and closes both services before disable completes", async () => {
    vi.useFakeTimers();
    let addresses: string[] = [];
    const events: string[] = [];
    const relay = { enableListener: async ({ host }: { host: string }) => { events.push("listen:" + host); },
      disableListener: async () => { events.push("disable"); }, connectionStatus: () => ({ listener: { host: "fixture", port: 9876 } }) };
    const host = new AutomaticSessionHost({} as SessionDevices, relay as never, "Studio", false, {
      addresses: () => [...addresses], discovery: address => ({ start: async () => { events.push("discover:" + address); },
        stop: async () => { events.push("stop-discovery"); } }),
    });
    try {
      await host.start();expect(events).toEqual([]);
      addresses = ["192.168.1.8"];
      await vi.advanceTimersByTimeAsync(5000);
      addresses = ["192.168.1.9"];
      await vi.advanceTimersByTimeAsync(5000);
      await host.stop();
      expect(events).toEqual(["listen:192.168.1.8", "discover:192.168.1.8", "stop-discovery", "disable",
        "listen:192.168.1.9", "discover:192.168.1.9", "stop-discovery", "disable"]);
      addresses = ["192.168.1.10"];await vi.advanceTimersByTimeAsync(10000);
      expect(events).toHaveLength(8);
    } finally { await host.stop();vi.useRealTimers(); }
  });

  it("limits production discovery to private IPv4 peers", () => {
    for (const address of ["0.0.0.0", "8.8.8.8", "127.0.0.1", "100.94.223.14", "::1", "192.168.1.1.evil"])
      expect(privatePeer(address)).toBe(false);
    for (const address of ["192.168.1.8", "10.2.3.4", "172.16.0.1", "::ffff:192.168.1.8"])
      expect(privatePeer(address)).toBe(true);
  });
  it("discovers and pairs without input, persists identity, and respects revocation", async () => {
    const root = await mkdtemp(join(tmpdir(), "kreoda-auto-pair-"));
    const devices = new SessionDevices(root);
    let service: SessionDiscovery | undefined;
    const socket = createSocket("udp4");
    try {
      await devices.load();
      service = new SessionDiscovery(devices, "Studio", { host: "127.0.0.1", sessionPort: 9876, discoveryPort: 0, allowLoopback: true });
      await service.start();
      const nonce = randomUUID();
      const received = new Promise<Buffer>(resolve => socket.once("message", resolve));
      socket.send(JSON.stringify({ protocol: "kreoda-discovery", version: 1, nonce }), service.port, "127.0.0.1");
      const reply = JSON.parse((await received).toString());
      expect(reply).toMatchObject({ nonce, pcId: devices.pcId, name: "Studio", sessionPort: 9876 });
      expect(JSON.stringify(reply)).not.toMatch(/credential|sessionToken|deviceId/);
      const installationId = randomUUID();
      const credential = randomBytes(32).toString("base64url");
      const request = () => fetch(`http://127.0.0.1:${reply.bootstrapPort}/pair`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1, pcId: reply.pcId, installationId, credential, name: "Quest 3" }),
      });
      const response = await request();
      expect(response.ok).toBe(true);
      const paired = await response.json() as { deviceId: string };
      expect(devices.authenticate(paired.deviceId, credential).deviceId).toBe(paired.deviceId);
      expect((await request()).ok).toBe(true);
      expect(devices.list()).toHaveLength(1);
      const restarted = new SessionDevices(root);
      await restarted.load();
      expect(restarted.pcId).toBe(devices.pcId);
      expect(restarted.authenticate(paired.deviceId, credential).deviceId).toBe(paired.deviceId);
      await devices.revoke(paired.deviceId);
      expect((await request()).status).toBe(403);
      const revoked = new SessionDevices(root);
      await revoked.load();
      await expect(revoked.pairAutomatic(installationId, credential, "Quest 3")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    } finally { socket.close(); await service?.stop(); await rm(root, { recursive: true, force: true }); }
  }, 30000);

  it("rejects browser origins, oversized bodies and mismatched PC identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "kreoda-auto-pair-"));
    const devices = new SessionDevices(root);
    let service: SessionDiscovery | undefined;
    try {
      await devices.load();
      service = new SessionDiscovery(devices, "Studio", { host: "127.0.0.1", sessionPort: 9876, discoveryPort: 0, allowLoopback: true });
      await service.start();
      const url = `http://127.0.0.1:${service.bootstrapPort}/pair`;
      expect((await fetch(url, { method: "POST", headers: { Origin: "https://example.com" }, body: "{}" })).status).toBe(403);
      expect((await fetch(url, { method: "POST", body: "a".repeat(8193) })).status).toBe(413);
      expect((await fetch(url, { method: "POST", body: JSON.stringify({ version: 1, pcId: randomUUID() }) })).status).toBe(400);
      expect(devices.list()).toHaveLength(0);
    } finally { await service?.stop(); await rm(root, { recursive: true, force: true }); }
  }, 30000);
});
