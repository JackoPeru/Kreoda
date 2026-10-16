import { createSocket, type Socket } from "node:dgram";
import { createServer, type Server } from "node:http";
import { isIP } from "node:net";
import type { SessionDevices } from "./session-devices";
import type { SessionRelay } from "./session";
import { sessionInterfaces } from "./session-listener";

export const DISCOVERY_PORT = 9843;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function privatePeer(address: string, loopback = false): boolean {
  address = address.replace(/^::ffff:/, "");
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split(".").map(Number);
  return (loopback && a === 127) || a === 10 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168);
}

/** One owner for LAN listener/discovery. Network changes are serialized with stop. */
export class AutomaticSessionHost {
  private timer: NodeJS.Timeout | null = null;
  private queue: Promise<void> = Promise.resolve();
  private discovery: Pick<SessionDiscovery, "start" | "stop"> | null = null;
  private host: string | null = null;
  private enabled = false;
  constructor(private readonly devices: SessionDevices,
    private readonly relay: Pick<SessionRelay, "enableListener" | "disableListener" | "connectionStatus">,
    private readonly name: string, private readonly loopbackTest = false,
    private readonly hooks?: { addresses: () => string[]; discovery: (host: string, port: number) => Pick<SessionDiscovery, "start" | "stop"> }) {}
  async start(): Promise<void> {
    this.enabled = true;
    await this.refresh();
    if (this.enabled) { this.timer = setInterval(() => { void this.refresh(); }, 5000);this.timer.unref(); }
  }
  private refresh(): Promise<void> {
    const next = this.queue.then(async () => {
      if (!this.enabled) return;
      const addresses = this.hooks?.addresses() ?? (this.loopbackTest ? ["127.0.0.1"] : sessionInterfaces().filter(item => !item.localOnly).map(item => item.address));
      addresses.sort((a, b) => Number(b.startsWith("192.168.")) - Number(a.startsWith("192.168.")) || a.localeCompare(b));
      const host = this.host && addresses.includes(this.host) ? this.host : addresses[0] ?? null;
      if (host === this.host) return;
      await this.discovery?.stop();this.discovery = null;
      if (this.host) await this.relay.disableListener();
      this.host = null;
      if (!host || !this.enabled) return;
      await this.relay.enableListener({ host, port: 0 });
      try {
        const port = this.relay.connectionStatus().listener!.port;
        const discovery = this.hooks?.discovery(host, port) ?? new SessionDiscovery(this.devices, this.name,
          { host, sessionPort: port, allowLoopback: this.loopbackTest });
        await discovery.start();
        this.discovery = discovery;this.host = host;
      } catch (error) { await this.relay.disableListener();throw error; }
    });
    this.queue = next.catch(() => { console.error("[session] automatic local connection temporarily unavailable"); });
    return this.queue;
  }
  async stop(): Promise<void> {
    this.enabled = false;
    if (this.timer) clearInterval(this.timer);this.timer = null;
    await this.queue;
    await this.discovery?.stop();this.discovery = null;
    if (this.host) await this.relay.disableListener();this.host = null;
  }
}

/** Discovery carries no credentials; native bootstrap only accepts private peers.
 * Socket addresses, never a packet's claimed host, select the peer. */
export class SessionDiscovery {
  private udp: Socket | null = null;
  private http: Server | null = null;
  private readonly rates = new Map<string, { since: number; count: number }>();
  port = 0;
  bootstrapPort = 0;
  constructor(private readonly devices: SessionDevices, private readonly name: string,
    private readonly options: { host: string; sessionPort: number; discoveryPort?: number; allowLoopback?: boolean }) {}

  async start(): Promise<void> {
    if (this.udp || this.http) throw new Error("discovery already started");
    if (!privatePeer(this.options.host, this.options.allowLoopback)) throw new Error("private interface required");
    const http = this.http = createServer(async (request, response) => {
      const send = (status: number, value: object): void => {
        response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        response.end(JSON.stringify(value));
      };
      if (!privatePeer(request.socket.remoteAddress ?? "", this.options.allowLoopback) || request.headers.origin ||
          request.method !== "POST" || (request.url !== "/pair" && request.url !== "/identify")) { send(403, { error: "FORBIDDEN" });return; }
      if (!this.allow(request.socket.remoteAddress ?? "")) { send(429, { error: "RATE_LIMIT" });return; }
      let size = 0;const chunks: Buffer[] = [];
      try {
        for await (const chunk of request) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bytes.length;
          if (size > 8192) { send(413, { error: "TOO_LARGE" });request.resume();return; }
          chunks.push(bytes);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
        if (request.url === "/identify") {
          if (!body || body.version !== 1 || body.pcId !== this.devices.pcId || typeof body.deviceId !== "string" ||
              typeof body.nonce !== "string" || !UUID.test(body.nonce)) { send(400, { error: "BAD_PARAMS" });return; }
          const proof = this.devices.proveDevice(body.deviceId, body.nonce);
          if (!proof) { send(404, { error: "UNKNOWN_DEVICE" });return; }
          send(200, { version: 1, pcId: this.devices.pcId, nonce: body.nonce, proof });return;
        }
        if (!body || body.version !== 1 || body.pcId !== this.devices.pcId ||
            typeof body.installationId !== "string" || typeof body.credential !== "string" || typeof body.name !== "string") {
          send(400, { error: "BAD_PARAMS" });return;
        }
        const paired = await this.devices.pairAutomatic(body.installationId, body.credential, body.name);
        send(200, { version: 1, pcId: this.devices.pcId, ...paired });
      } catch (error) {
        send((error as { code?: string }).code === "UNAUTHORIZED" ? 403 : 400, { error: "PAIR_FAILED" });
      }
    });
    http.requestTimeout = 5000;http.headersTimeout = 5000;http.maxConnections = 16;
    try {
      await new Promise<void>((resolve, reject) => {
        http.once("error", reject);http.listen(0, this.options.host, () => { http.off("error", reject);resolve(); });
      });
      this.bootstrapPort = (http.address() as { port: number }).port;
      http.on("error", () => {});
      const udp = this.udp = createSocket("udp4");
      udp.on("message", (packet, peer) => {
        if (packet.length > 4096 || !privatePeer(peer.address, this.options.allowLoopback) || !this.allow(peer.address)) return;
        try {
          const value = JSON.parse(packet.toString("utf8")) as Record<string, unknown>;
          if (!value || value.protocol !== "kreoda-discovery" || value.version !== 1 ||
              typeof value.nonce !== "string" || !UUID.test(value.nonce)) return;
          const reply = Buffer.from(JSON.stringify({ protocol: "kreoda-discovery", version: 1, nonce: value.nonce,
            pcId: this.devices.pcId, name: this.name.slice(0, 80), sessionPort: this.options.sessionPort,
            bootstrapPort: this.bootstrapPort }));
          udp.send(reply, peer.port, peer.address, () => {});
        } catch { /* Ignore unrelated LAN datagrams. */ }
      });
      await new Promise<void>((resolve, reject) => {
        udp.once("error", reject);
        udp.bind(this.options.discoveryPort ?? DISCOVERY_PORT, this.options.allowLoopback ? "127.0.0.1" : "0.0.0.0", () => {
          udp.off("error", reject);resolve();
        });
      });
      udp.on("error", () => {});
      this.port = udp.address().port;
    } catch (error) { await this.stop();throw error; }
  }
  private allow(peer: string): boolean {
    const now = Date.now();
    let rate = this.rates.get(peer);
    if (!rate || now - rate.since > 60000) {
      if (this.rates.size >= 256) this.rates.clear();
      rate = { since: now, count: 0 };this.rates.set(peer, rate);
    }
    return ++rate.count <= 60;
  }
  async stop(): Promise<void> {
    const udp = this.udp;this.udp = null;
    const http = this.http;this.http = null;
    this.port = this.bootstrapPort = 0;
    this.rates.clear();
    if (udp) { try { udp.close(); } catch { /* Failed bind. */ } }
    if (http) await new Promise<void>(resolve => { http.close(() => resolve());http.closeAllConnections(); });
  }
}
