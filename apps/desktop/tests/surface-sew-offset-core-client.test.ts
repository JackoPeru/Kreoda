import { afterEach, expect, it, vi } from "vitest";
import { CommandType, PROTOCOL_VERSION } from "@kreoda/protocol";
import { coreClient } from "../src/ipc/coreClient";

const reply = (result: Record<string, unknown>) => new TextEncoder().encode(JSON.stringify({
  protocolVersion: PROTOCOL_VERSION,
  requestId: "surface-edit",
  status: "ok",
  ...result,
}));

function wire(result: Record<string, unknown>) {
  return vi.spyOn(coreClient as unknown as {
    roundTrip: (envelope: unknown) => Promise<Uint8Array>;
  }, "roundTrip").mockResolvedValue(reply(result));
}

const editedFeature = {
  featureId: "offset-1",
  type: "SurfaceOffset",
  paramsMm: [-3.5, 0.001],
  dependsOn: ["sheet-1"],
  refExtra: "",
  expressions: {},
  bboxMm: [0, -7, -7, 20, 7, 7],
  revision: 8,
};

afterEach(() => vi.restoreAllMocks());

it("accepts native SurfaceOffset edit replies without a solid volume", async () => {
  const transport = wire(editedFeature);

  const updated = await coreClient.setFeatureParameter("offset-1", "distanceMm", -3.5);

  expect(updated).toMatchObject({ featureId: "offset-1", type: "SurfaceOffset", revision: 8 });
  expect(updated).not.toHaveProperty("volumeMm3");
  expect(transport.mock.calls[0]![0]).toMatchObject({
    type: CommandType.SetFeatureParameter,
    featureId: "offset-1",
    paramName: "distanceMm",
    valueMm: -3.5,
    isPreview: false,
  });
});

it("preserves the native volume on SurfaceSewnSolid edit replies", async () => {
  wire({
    ...editedFeature,
    featureId: "sewn-solid-1",
    type: "SurfaceSewnSolid",
    paramsMm: [0.01],
    dependsOn: ["sew-1", "cap-1"],
    volumeMm3: 2000,
    bboxMm: [0, 0, 0, 10, 10, 20],
  });

  const updated = await coreClient.setFeatureParameter("sewn-solid-1", "toleranceMm", 0.01);

  expect(updated).toMatchObject({ featureId: "sewn-solid-1", type: "SurfaceSewnSolid", volumeMm3: 2000 });
});

it.each(["0", -1, null])("rejects malformed native volume values: %j", async volumeMm3 => {
  wire({ ...editedFeature, volumeMm3 });

  await expect(coreClient.setFeatureParameter("offset-1", "distanceMm", -3.5)).rejects.toThrow();
});
