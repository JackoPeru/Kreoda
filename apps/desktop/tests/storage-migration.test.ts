// Pre-rename localStorage migration (intentcad.* → kreoda.*, one-time).
import { describe, expect, it, vi, afterEach } from "vitest";

afterEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("storage key migration", () => {
  it("carries legacy keys forward and drops them", async () => {
    localStorage.setItem("intentcad.llmEndpoint", "http://loopback-test:9/v1");
    localStorage.setItem("intentcad.llmModel", "old-model");
    localStorage.setItem("intentcad.telemetry", "1");
    const { usePreferencesStore } = await import("../src/stores/index.js");
    const s = usePreferencesStore.getState();
    expect(s.llmEndpoint).toBe("http://loopback-test:9/v1");
    expect(s.llmModel).toBe("old-model");
    expect(s.telemetryEnabled).toBe(true);
    expect(localStorage.getItem("kreoda.llmEndpoint")).toBe(
      "http://loopback-test:9/v1",
    );
    expect(localStorage.getItem("kreoda.telemetry")).toBe("1");
    expect(localStorage.getItem("intentcad.llmEndpoint")).toBeNull();
    expect(localStorage.getItem("intentcad.llmModel")).toBeNull();
    expect(localStorage.getItem("intentcad.telemetry")).toBeNull();
  });

  it("prefers new keys when both exist", async () => {
    localStorage.setItem("intentcad.llmEndpoint", "http://old:9/v1");
    localStorage.setItem("kreoda.llmEndpoint", "http://new:9/v1");
    const { usePreferencesStore } = await import("../src/stores/index.js");
    expect(usePreferencesStore.getState().llmEndpoint).toBe(
      "http://new:9/v1",
    );
  });
});
