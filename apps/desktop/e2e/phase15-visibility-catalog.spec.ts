import { test, expect } from "@playwright/test";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot } from "./helpers";
import { SessionClient } from "./ws-test-client";

test("real Electron session advertises visibility44, inward pocket45 and face thicken46", async () => {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  const profile = mkdtempSync(path.join(os.tmpdir(), "kreoda-catalog44-"));
  const token = `catalog44-${process.pid}`;
  const { app } = await boot({ KREODA_BACKGROUND_TEST: "1", KREODA_SESSION_PORT: String(port), KREODA_SESSION_TOKEN: token }, [`--user-data-dir=${profile}`]);
  const peer = new SessionClient();
  try {
    await peer.connect(token, port);
    const response = await peer.call("getCommandSchema", { id: "SetBodyVisibility" });
    expect(response["result"]).toMatchObject({ id: "SetBodyVisibility", nativeType: 44,
      parameters: { type: "object", required: ["bodyId", "visible"] } });
    const pocket = await peer.call("getCommandSchema", { id: "CreateInwardFacePocket" });
    expect(pocket["result"]).toMatchObject({ id: "CreateInwardFacePocket", nativeType: 45,
      creation: { fixedCount: 1 },
      parameters: { type: "object", required: ["sourceFeatureId", "faceRole", "distanceMm"] } });
    const thicken = await peer.call("getCommandSchema", { id: "CreateSurfaceFaceThicken" });
    expect(thicken["result"]).toMatchObject({ id: "CreateSurfaceFaceThicken", nativeType: 46,
      creation: { fixedCount: 1 },
      parameters: { type: "object", required: ["sourceFeatureId", "faceRole", "thicknessMm"] } });
    const mate = await peer.call("getCommandSchema", { id: "DefineAssemblyConstraint" });
    expect(mate["result"]).toMatchObject({ id: "DefineAssemblyConstraint", nativeType: 47,
      creation: { fixedCount: 0 } });
  } finally { peer.closeRaw(); await app.close(); rmSync(profile, { recursive: true, force: true }); }
});
