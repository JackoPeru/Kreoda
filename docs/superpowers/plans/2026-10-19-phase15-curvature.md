# Phase 15 curvature visualization

Original scope remains the full Phases 12–16 roadmap. This packet implements
the missing curvature visualization on Desktop and Quest; other outstanding
surface, thickness, assembly, direct-edit and live-agent gates remain open.

User authorization permits autonomous implementation and hidden local builds.
Luna/reviewer quota is exhausted; the parent continues under the explicit
fallback. Preserve concurrent work and do not contact busy Hermes services.

## Design

Native OCCT evaluates maximum absolute principal curvature at the existing
surface tessellation UV nodes, in inverse millimetres. Plane = 0; unknown or
singular sample = -1. Values follow the existing per-face vertex ordering;
sharp face boundaries remain separate. This is a sampled surface analysis,
not a continuity or global-minimum certificate. No geometry/history mutation.

Append an optional packed float32 field to MeshUpdate. Existing meshes/clients
remain readable. Both TS and managed readers reject inconsistent length,
nonfinite samples and negative values other than the unknown sentinel.
No new query endpoint or duplicated geometry is needed.

Clients display a reversible blue-to-red heatmap with a visible physical
scale and neutral unknown samples. Preserve canonical meshes, colliders,
semantic picking, section clipping, preview distinction and document reset.
Zebra and curvature modes are mutually exclusive presentations. No new
dependency; Quest controls use the existing pinch/controller action path.

## Gates

- [x] Native RED/GREEN: analytic sphere and cylinder/caps, placement, reversed
      orientation and unknown handling; immutable geometry identity.
- [x] Binary schema/generated bindings/native encoder and TS/managed validation:
      old payloads, valid samples, malformed count/value rejection.
- [x] Desktop controls, legend, current/future mesh presentation and lifecycle;
      actual native Electron GPU verification, no mesh/revision change.
- [x] Quest presentation and hand-routed controls, section/preview coexistence;
      actual Editor GPU renders and focused regressions.
- [x] Guarded Desktop package and normal ARM64 APK; install authorized targets
      without foreground PC windows. State physical acceptance limits exactly.

Full goal must not be marked complete from this packet.

Delivered evidence: `../evidence/2026-10-19-phase15-curvature-verification.md`.
Physical in-headset visibility, comfort and fresh LAN acceptance remain open.
