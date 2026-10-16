# Phase13 Task4 semantic intent and serialized edit worker

Accepted source adds an immutable session/document/revision/feature/body/tip intent, declared CAD axes and units, inverse display frame math, signed scalar/planar/position projection and canonical extrinsic-ZYX rotation. Native Instance metadata now declares its actual position/rotation basis and XY plane. Prediction is engine neutral; this packet does not implement Unity interaction.

One background worker coalesces drafts at a 100ms cadence, flushes the final draft, obtains distinct checked preview meshes and commits once. Invalid final values cancel rather than commit the preceding value. Candidates are fenced by local draft version and native generation. Revision changes cancel the locked intent. Original operation replay and snapshots reconcile lost commit acknowledgements.

Fresh review found and root reproduced pre-send cancellation, unresolved owned cancel cleanup and unsupported rotation basis issues. Commit authorization now runs under the gesture lock after the actual SessionClient send queue. Before that boundary cancellation prevents sending; after it the authoritative operation outcome is reconciled. Two unresolved cancel attempts close the borrowed connection so the owner can reconnect and the server releases reservations. Canonical Instance rotation requires global identity parameter axes. A further meaningful RED test reproduced caller dictionary casing escaping Exact; output now copies canonical parameter names.

Verification:

- Full actual net8 libraries and runner:114/114, direct exit0.
- Full actual netstandard2.1 libraries with net8 runner:114/114, direct exit0.
- Actual OCCT native suite:173/173,64.321s,0failures/0errors.
- Deterministic tests gate begin coalescing and the real send semaphore. Tests cover pre-send and post-send cancellation, lost cancel/commit acknowledgements, invalid final value, stale candidates, changed revision, no-movement release and transformed display scales.
- Same-feature server reservations and canonical one-command compound history are inherited from the previously accepted Task3 actual Desktop/OCCT+C# proof; they are not reimplemented in the worker.
- Fresh final reviewer01a1286f-635f-7751-a26b-5a89057f8f41:SHIP, actual gpt-6-sol/high verified from runtime metadata. Behavioral read-only under host danger-full-access/disabled permissions; no enforced isolation claim.
- All777 source inputs unchanged before/after final review, manifest SHA794cb2b00dee050ad62d2ebaa15d50f23c0a22d711271a2050a4116bc75784d2.

No Unity, APK deployment, physical interaction or comfort result is claimed for Task4. Task5-7 and Phases14-16 remain open. Original sole Luna task exhausted quota; root continues under the user's explicit fallback authorization. No manual Quest configuration is required.
