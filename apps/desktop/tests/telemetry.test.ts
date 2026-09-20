// Telemetry gate (§61): explicit opt-in, default OFF, local sink only.
import { describe, expect, it } from "vitest";
import { usePreferencesStore } from "../src/stores";
import {
  clearTelemetryQueue,
  recordEvent,
  telemetryQueue,
} from "../src/telemetry/events";

describe("telemetry opt-in (§61)", () => {
  it("drops everything while disabled (the default)", () => {
    usePreferencesStore.getState().setTelemetry(false);
    clearTelemetryQueue();
    recordEvent("plan_committed", { steps: 1 });
    expect(telemetryQueue()).toHaveLength(0);
    // Default state (fresh profile) is off.
    expect(usePreferencesStore.getState().telemetryEnabled).toBe(false);
  });

  it("records locally once explicitly enabled (no network)", () => {
    usePreferencesStore.getState().setTelemetry(true);
    clearTelemetryQueue();
    try {
      recordEvent("plan_committed", { steps: 2, source: 0 });
      const q = telemetryQueue();
      expect(q).toHaveLength(1);
      expect(q[0]!.name).toBe("plan_committed");
      expect(q[0]!.props["steps"]).toBe(2);
    } finally {
      usePreferencesStore.getState().setTelemetry(false);
      clearTelemetryQueue();
    }
  });
});
