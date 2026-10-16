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
      const proof = createHmac("sha256", key).update(JSON.stringify([pcId, body.deviceId, body.nonce])).digest("hex");
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ version: 1, pcId, nonce: body.nonce, proof }));
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
