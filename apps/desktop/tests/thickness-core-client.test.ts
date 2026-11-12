import { afterEach, expect, it, vi } from "vitest";
import { CommandType, PROTOCOL_VERSION } from "@kreoda/protocol";
import { coreClient } from "../src/ipc/coreClient";

const measured = { basis: "occt-sampled-normal-rays", isGlobalMinimum: false, featureId: "box", requestedSamples: 128,
  solidCount: 1, totalFaces: 6, sampledFaces: 6, attemptedSamples: 128, validSamples: 128, missedSamples: 0,
  timeBudgetExceeded: false, minimumThicknessMm: 2, witness: { pointAMm: [10,20,30], pointBMm: [10,20,32] } };
const reply = (result: unknown) => new TextEncoder().encode(JSON.stringify({ protocolVersion: PROTOCOL_VERSION,
  requestId: "thickness", status: "ok", result }));
function wire(result: unknown = measured) {
  return vi.spyOn(coreClient as unknown as { roundTrip: (envelope: unknown) => Promise<Uint8Array> }, "roundTrip").mockResolvedValue(reply(result));
}
afterEach(() => vi.restoreAllMocks());

it("requests the canonical non-mutating thickness query and preserves native witness coordinates", async () => {
  const transport = wire();
  expect(await coreClient.measureMinimumThickness({ featureId: "box", maxSamples: 128 })).toEqual(measured);
  expect(transport.mock.calls[0]![0]).toMatchObject({ type: CommandType.RequestSessionQuery,
    method: "measureMinimumThickness", params: { featureId: "box", maxSamples: 128 } });
});

it.each([
  { isGlobalMinimum: true }, { basis: "bbox" }, { minimumThicknessMm: 0 }, { validSamples: 129 },
  { missedSamples: 1 }, { witness: null }, { witness: { pointAMm: [0,0,0], pointBMm: [20,0,0] } },
])("rejects misleading or inconsistent thickness results: %j", async invalid => {
  wire({ ...measured, ...invalid });
  await expect(coreClient.measureMinimumThickness({ featureId: "box" })).rejects.toThrow();
});

it("keeps unmeasured thickness unknown rather than showing zero", async () => {
  wire({ ...measured, sampledFaces: 0, validSamples: 0, missedSamples: 128, minimumThicknessMm: null, witness: null });
  const result = await coreClient.measureMinimumThickness({ featureId: "box" });
  expect(result.minimumThicknessMm).toBeNull();expect(result.witness).toBeNull();
});
