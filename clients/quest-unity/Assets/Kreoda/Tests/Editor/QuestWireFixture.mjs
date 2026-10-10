// Transport fixture, not a live CAD-engine test. Raw geometry is authentic OCCT.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(new URL("../../../../../../apps/desktop/package.json", import.meta.url));
const { WebSocketServer } = require("ws");
const fixture = JSON.parse(readFileSync(process.argv[2], "utf8"));
const bytes = readFileSync(fixture.file);
const sessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const documentId = "fixture-doc";
const server = new WebSocketServer({ host: "0.0.0.0", port: 0 });
server.on("listening", () => console.log(JSON.stringify({ port: server.address().port })));
server.on("connection", socket => socket.on("message", data => {
  const request = JSON.parse(data.toString());
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
        capabilities: ["incremental-deltas", "binary-mesh-v1"] });
      break;
    case "snapshot":
      reply({ sessionId, documentId, revision: fixture.revision, sketches: [],
        bodies: [{ bodyId: "body-root", tip: fixture.featureId, history: [fixture.featureId] }],
        features: [{ featureId: fixture.featureId, type: "Box", dependsOn: [], paramsMm: [100, 50, 10] }] });
      break;
    case "requestMeshLOD":
      if (request.params.expectedRevision !== fixture.revision || request.params.quality !== fixture.quality)
        throw new Error("wrong fixture mesh revision or quality");
      reply({ result: { nativeRequestId: fixture.nativeId, sessionId, documentId, revision: fixture.revision,
        bodyId: "body-root", featureId: fixture.featureId, tipId: fixture.featureId,
        quality: fixture.quality, byteLength: bytes.length } });
      socket.send(bytes);
      break;
    default:
      reply({ result: {} });
  }
}));
