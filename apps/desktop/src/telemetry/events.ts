// Usage telemetry sink (§61): explicit opt-in, default OFF, local only.
// No backend is wired: when enabled, events land in a bounded in-memory
// queue (inspectable, never transmitted); when disabled, everything is
// dropped at the gate. Nothing here may touch the network — ever.

import { usePreferencesStore } from "../stores";

export interface TelemetryEvent {
  name: string;
  at: number;
  props: Record<string, string | number | boolean>;
}

const MAX_QUEUE = 100;
const queue: TelemetryEvent[] = [];

/** Gate + record. Safe to call from any UI path (never throws, never I/O). */
export function recordEvent(
  name: string,
  props: Record<string, string | number | boolean> = {},
): void {
  try {
    if (!usePreferencesStore.getState().telemetryEnabled) return;
    // Bound the sink (M-minor): caller-controlled strings must not grow it.
    const slim: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(props).slice(0, 10)) {
      slim[k.slice(0, 64)] =
        typeof v === "string" ? v.slice(0, 200) : v;
    }
    queue.push({ name: name.slice(0, 64), at: Date.now(), props: slim });
    while (queue.length > MAX_QUEUE) queue.shift();
  } catch {
    // Telemetry must never break the app.
  }
}

/** Test/diagnostics peek (a copy — callers cannot mutate the sink). */
export function telemetryQueue(): TelemetryEvent[] {
  return [...queue];
}

/** Test reset. */
export function clearTelemetryQueue(): void {
  queue.length = 0;
}

// Opt-out purges (M13): disabling telemetry must not leave prior events
// inspectable. Subscribed (not imported by the store) to avoid a cycle.
usePreferencesStore.subscribe((s) => {
  if (!s.telemetryEnabled) clearTelemetryQueue();
});
