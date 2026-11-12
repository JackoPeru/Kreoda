// Transport fixture, not a live CAD-engine test. Raw geometry is authentic OCCT.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createSocket } from "node:dgram";
import { createServer } from "node:http";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
const require = createRequire(new URL("../../../../../../apps/desktop/package.json", import.meta.url));
const { WebSocketServer } = require("ws");
const fixture = JSON.parse(readFileSync(process.argv[2], "utf8"));
const bytes = readFileSync(fixture.file);
const sessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const documentId = "fixture-doc";
const datumId = "datum-plane-wire";
const requests = [];
let connectionCount = 0;
const discoveryAudit = { identifyRequests: 0, wrongSocketMessages: 0, credentialInIdentityProbe: false };
const multiPcs = [];
const pcAId = "11111111-1111-4111-8111-111111111111";
const pcBId = "22222222-2222-4222-8222-222222222222";

function automaticConnection(pc, socket) {
  socket.on("message", data => {
    const request = JSON.parse(data.toString());
    const reply = payload => socket.send(JSON.stringify({ requestId: request.requestId, ok: true, ...payload }));
    const reject = (errorCode, error) => socket.send(JSON.stringify({ requestId: request.requestId, ok: false, errorCode, error }));
    switch (request.method) {
      case "authenticate": {
        pc.audit.authentications.push({ deviceId: request.params.deviceId, credential: request.params.credential });
        const identity = pc.identities.get(request.params.deviceId);
        if (!identity || identity.credential !== request.params.credential ||
            (pc.id === pcBId && fixture.switchMode === "reject")) { reject("UNAUTHORIZED", "unknown fixture identity");break; }
        reply({ deviceId: identity.deviceId, sessionToken: "fixture-session-token" });
        break;
      }
      case "hello":
        pc.audit.hellos++;
        reply({ clientId: request.params.clientId, sessionId: pc.id, documentId: "fixture-" + pc.id,
          revision: 1, capabilities: ["incremental-deltas"] });
        break;
      case "snapshot":
        pc.audit.snapshots++;
        const sendSnapshot = () => {
          if (socket.readyState !== 1) return;
          reply({ sessionId: pc.id, documentId: "fixture-" + pc.id, revision: 1,
            sketches: [], bodies: [], features: fixture.switchMode === "bad-snapshot" && pc.id === pcBId ? "invalid" : [] });
        };
        if (pc.id === pcBId && fixture.switchMode === "late") setTimeout(sendSnapshot, 2500);
        else sendSnapshot();
        break;
      case "getCapabilities":
        reply({ result: { multiPcAudit: pc.audit } });
        break;
      case "getSessionInfo":
        reply({ result: { sessionId: pc.id, documentId: "fixture-" + pc.id,
          documentRevision: 1, connectedClients: [], transactionState: null } });
        break;
      default:
        reply({ result: {} });
    }
  });
}

async function startMultiPcFixture() {
  const second = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(second, "listening");
  multiPcs.push(
    { id: pcAId, name: "Fixture PC A", ws: server,
      audit: { bootstraps: [], authentications: [], hellos: 0, snapshots: 0 }, identities: new Map() },
    { id: pcBId, name: "Fixture PC B", ws: second,
      audit: { bootstraps: [], authentications: [], hellos: 0, snapshots: 0 }, identities: new Map() },
  );
  multiPcs.forEach((pc, index) => {
    if (index > 0) pc.ws.on("connection", socket => automaticConnection(pc, socket));
    pc.http = createServer(async (request, response) => {
      const chunks = [];
      let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 8192) { response.writeHead(413);response.end();return; }
        chunks.push(chunk);
      }
      if (request.url === "/audit" && request.method === "GET") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ...pc.audit, bootstraps: pc.audit.bootstraps.map(item => ({ ...item })),
          authentications: pc.audit.authentications.map(item => ({ ...item })) }));
        return;
      }
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      if (request.url === "/identify" && request.method === "POST") {
        const identity = pc.identities.get(body.deviceId);
        if (!identity) { response.writeHead(403);response.end();return; }
        const key = createHash("sha256").update(identity.credential).digest();
        const parts = [pc.id, body.deviceId, body.nonce];
        if (body.proofVersion === 2) parts.push("127.0.0.1", String(pc.ws.address().port), String(pc.http.address().port));
        const proof = createHmac("sha256", key).update(JSON.stringify(parts)).digest("hex");
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ version: 1, pcId: pc.id, nonce: body.nonce, proof,
          ...(body.proofVersion === 2 ? { proofVersion: 2 } : {}) }));
        return;
      }
      if (request.url === "/pair" && request.method === "POST") {
        if (body.version !== 1 || body.pcId !== pc.id) { response.writeHead(403);response.end();return; }
        let identity = pc.identities.get(body.installationId);
        if (identity && identity.credential !== body.credential) { response.writeHead(403);response.end();return; }
        if (!identity) {
          identity = { deviceId: "device-" + randomUUID(), credential: body.credential, installationId: body.installationId };
          pc.identities.set(body.installationId, identity);
          pc.identities.set(identity.deviceId, identity);
        }
        pc.audit.bootstraps.push({ installationId: body.installationId, credential: body.credential, deviceId: identity.deviceId });
        if (pc.id === pcBId && fixture.switchMode === "lost-ack" && pc.audit.bootstraps.length === 1) {
          response.destroy();return;
        }
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ version: 1, pcId: pc.id, deviceId: identity.deviceId }));
        return;
      }
      response.writeHead(404);response.end();
    });
    pc.http.listen(0, "127.0.0.1");
  });
  await Promise.all(multiPcs.map(pc => once(pc.http, "listening")));
  const udp = createSocket("udp4");
  udp.on("message", (data, peer) => {
    try {
      const body = JSON.parse(data.toString("utf8"));
      multiPcs.filter(pc => fixture.switchMode !== "legacy-offline" || pc.id === pcAId).forEach(pc => udp.send(JSON.stringify({ protocol: "kreoda-discovery", version: 1,
        nonce: body.nonce, pcId: pc.id, name: pc.name, sessionPort: pc.ws.address().port,
        bootstrapPort: pc.http.address().port }), peer.port, peer.address));
    } catch { }
  });
  udp.bind(9843, "127.0.0.1");
  await once(udp, "listening");
  console.log(JSON.stringify({ multiPc: true, pcIds: [pcAId, pcBId] }));
}

const referenceOperations = {
  CreateDatumPlane: ["principal", "offset", "mid", "angle", "threePoint"],
  CreateDatumAxis: ["twoPoint", "planeNormal", "planeIntersection"],
  CreateDatumPoint: ["coordinates", "midpoint"],
  UpdateDatum: ["principal", "offset", "mid", "angle", "threePoint", "twoPoint", "planeNormal", "planeIntersection", "coordinates", "midpoint"],
};
const referenceSchema = id => ({ type: "object", properties: {
  ...(id === "UpdateDatum" ? { featureId: { type: "string", minLength: 1 } } : {}),
  definition: { anyOf: referenceOperations[id].map(type => ({ type: "object", properties: { type: { type: "string", const: type } } })) },
}, required: id === "UpdateDatum" ? ["featureId", "definition"] : ["definition"] });
const server = new WebSocketServer({ host: "0.0.0.0", port: 0 });
server.on("listening", async () => {
  if (fixture.multiPc) { await startMultiPcFixture();return; }
  if (fixture.legacyDiscoveryMode) {
    const known = fixture.legacyDiscoveryMode === "known";
    const pcId = randomUUID();
    let sessionPort = server.address().port;
    if (!known) {
      const wrong = new WebSocketServer({ host: "127.0.0.1", port: 0 });
      await once(wrong, "listening");sessionPort = wrong.address().port;
      wrong.on("connection", socket => socket.on("message", () => { discoveryAudit.wrongSocketMessages++;socket.close(); }));
    }
    const http = createServer(async (request, response) => {
      let text = "";for await (const chunk of request) text += chunk;
      discoveryAudit.identifyRequests++;
      if (text.includes('"credential"') || text.includes("A".repeat(43))) discoveryAudit.credentialInIdentityProbe = true;
      const body = JSON.parse(text);
      const key = createHash("sha256").update((known ? "A" : "C").repeat(43)).digest();
      const parts = [pcId, body.deviceId, body.nonce];
      if (body.proofVersion === 2) parts.push("127.0.0.1", String(sessionPort), String(http.address().port));
      const proof = createHmac("sha256", key).update(JSON.stringify(parts)).digest("hex");
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ version: 1, pcId, nonce: body.nonce, proof,
        ...(body.proofVersion === 2 ? { proofVersion: 2 } : {}) }));
    });
    http.listen(0, "127.0.0.1");await once(http, "listening");
    const udp = createSocket("udp4");
    udp.on("message", (data, peer) => {
      const body = JSON.parse(data.toString());
      udp.send(JSON.stringify({ protocol: "kreoda-discovery", version: 1, nonce: body.nonce, pcId,
        name: known ? "Old Studio" : "Unrelated PC", sessionPort, bootstrapPort: http.address().port }), peer.port, peer.address);
    });
    udp.bind(9843, "127.0.0.1");await once(udp, "listening");
  }
  console.log(JSON.stringify({ port: server.address().port }));
});
server.on("connection", socket => {
  if (fixture.multiPc) { automaticConnection(multiPcs[0], socket);return; }
  const connection = ++connectionCount;
  socket.on("message", async data => {
  const request = JSON.parse(data.toString());
  if (fixture.datumMode) {
    requests.push({ method: request.method, params: request.params, sessionId: request.sessionId, connection });
  }
  const reply = payload => socket.send(JSON.stringify({ requestId: request.requestId, ok: true, ...payload }));
  switch (request.method) {
    case "pair":
      if (request.params.pairingToken !== "01234567") throw new Error("wrong fixture pairing code");
      reply({ deviceId: "device-fixture", credential: "A".repeat(43), sessionToken: "B".repeat(43) });
      break;
    case "authenticate":
      if (request.params.credential !== "A".repeat(43)) throw new Error("credential was not preserved");
      reply({ deviceId: "device-fixture", sessionToken: "B".repeat(43) });
      break;
    case "hello":
      reply({ clientId: request.params.clientId, sessionId, documentId, revision: fixture.revision,
        capabilities: ["incremental-deltas", "binary-mesh-v1", "context-commands-v1"] });
      break;
    case "snapshot":
      reply({ sessionId, documentId, revision: fixture.revision, sketches: [],
        bodies: [{ bodyId: "body-root", tip: fixture.featureId, history: [fixture.featureId] }],
        features: [{ featureId: fixture.featureId, type: "Box", dependsOn: [], paramsMm: [100, 50, 10] }],
        ...(fixture.datumMode ? { datums: [{ featureId: datumId, kind: "DatumPlane", status: "ok", dependsOn: [],
          definition: { type: "offset", base: { type: "principal", planeKind: "XY" }, offsetMm: 24 },
          resolved: { originMm: [0, 0, 24], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] } }] } : {}) });
      break;
    case "listCommands":
      if (!fixture.datumMode || request.params.expectedRevision !== fixture.revision)
        throw new Error("wrong datum context identity/revision");
      const selected = request.params.selectionIds ?? [];
      if (selected.length && (selected.length !== 1 || selected[0] !== datumId))
        throw new Error("wrong datum context identity");
      const commands = selected.length ? [
        { id: "CreateSketch", label: "Sketch sul piano", description: "Fixture support binding",
          available: true, supportsPreview: false, boundParameters: { supportRef: datumId, planeKind: connection === 1 ? "XY" : "XZ" } },
        { id: "UpdateDatum", label: "Modifica datum", description: "Fixture edit action",
          available: true, supportsPreview: false, boundParameters: {} },
      ] : ["CreateDatumPlane", "CreateDatumAxis", "CreateDatumPoint"].map(id => ({
        id, label: id, description: "Fixture reference action", available: true,
        supportsPreview: false, boundParameters: {},
      }));
      reply({ result: { sessionId, documentId, revision: fixture.revision, contextValid: true,
        commands } });
      break;
    case "getCommandSchema":
      if (referenceOperations[request.params.id]) {
        reply({ result: { parameters: referenceSchema(request.params.id) } });
        break;
      }
      reply({ result: { parameters: { type: "object", properties: {
        planeKind: { type: "string", default: "XY" }, supportRef: { type: "string" }, model: { type: "object", default: {} }
      }, required: ["supportRef", "model"] } } });
      break;
    case "getCapabilities":
      reply({ result: { fixtureRequests: requests, discoveryAudit } });
      break;
    case "getSessionInfo":
      reply({ result: { sessionId, documentId, documentRevision: fixture.revision, connectedClients: [], transactionState: null } });
      break;
    case "requestMeshLOD":
      if (request.params.expectedRevision !== fixture.revision || request.params.quality !== fixture.quality)
        throw new Error("wrong fixture mesh revision or quality");
      reply({ result: { nativeRequestId: fixture.nativeId, sessionId, documentId, revision: fixture.revision,
        bodyId: "body-root", featureId: fixture.featureId, tipId: fixture.featureId,
        quality: fixture.quality, byteLength: bytes.length } });
      socket.send(bytes);
      break;
    case "getManipulators":
      reply({ result: { featureId: fixture.featureId, manipulators: [{ id: "width", type: "linear",
        parameter: "widthMm", unit: "mm", origin: [100, 25, 10], axis: [1, 0, 0], currentValues: { widthMm: 100 } }] } });
      break;
    case "command":
      if (request.params.documentId !== documentId || request.params.baseRevision !== fixture.revision)
        throw new Error("command did not carry current fixture lineage");
      if (request.params.commandId === fixture.delayCommandId && fixture.delayCommandMs > 0)
        await new Promise(resolve => setTimeout(resolve, fixture.delayCommandMs));
      if (request.params.commandId === fixture.rejectCommandId) {
        socket.send(JSON.stringify({ requestId: request.requestId, ok: false,
          errorCode: "DATUM_FAILED", error: "Fixture rejected datum" }));
        break;
      }
      reply({ result: { accepted: true } });
      break;
    default:
      reply({ result: {} });
  }
  });
});
