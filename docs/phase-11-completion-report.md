# Phase 11 completion — authoritative shared CAD session

Status: **COMPLETE**, 2026-10-04. Verified product source:
`4f357355fd4c860a7094a9067bfb4db2e4fed7a4`.

Implements the approved roadmap sections 11.0–11.17 and protocol decision
B: JSON session control with the existing FlatBuffers native mesh plane.
Desktop, paired network clients and compiled C# clients share authoritative
mutation ordering, revision/lineage fences, transaction and preview ownership,
operation replay, incremental deltas and snapshot recovery. Native geometry
queries use OCCT; contracts and control DTOs derive from canonical schemas.
Private listeners require explicit activation; device credentials are persisted
as digests and revocation closes existing connections.

## Verification

| Gate | Result |
|---|---|
| Workspace / Desktop tests | 219 / 176 passed |
| C# client tests | 36 passed |
| Actual OCCT native tests | 156 passed |
| Typecheck, build, generated contract drift | Passed |
| Local ordinary Desktop cohort | 53 passed; two hosted-only cases skipped |
| Local crash cohort | 29 passed |
| Production portable runtime | Nine checks passed; packaged bytes unchanged |
| Packaged native dependencies | 45 payloads; three valid Microsoft CRT signatures |
| Exact hosted product CI | Success: 55 ordinary and 29 crash cases |
| Fresh GPT-6-Sol / High review | ship; 581-file freeze intact afterward |

Hosted run: [37207487694](https://github.com/JackoPeru/Kreoda/actions/runs/37207487694).
This includes clean-host Squirrel installation, the installed application and
native file dialog, native self-tests, crash-barrier ON testing and restoration
to production OFF. Earlier run 37196940208 failed because the MSVC environment
changed the C# probe output path; explicit AnyCPU fixes that cause. The earlier
review's unsupported preview and preview ordering findings have deterministic
RED/GREEN regressions and real OCCT/Desktop acceptance checks.

The API-driven saved-document acceptance uses production Desktop IPC, an
explicit private listener, real device pairing and actual OCCT. It opens a
saved model, joins/snapshots, edits an existing parameter, applies Desktop
incremental geometry while retaining camera/selection/unchanged meshes,
performs Desktop Undo, checks matching revisions, reconnects, rejects invalid
and stale commands, verifies preview bursts and revokes the device. No GUI
input is used in that acceptance.

Current immutable local records:

- `docs/evidence/phase11-preview-fixed-regression-local-2026-10-04.json`
- `docs/evidence/phase11-preview-fixed-native-runtime-local-2026-10-04.json`
- `docs/evidence/phase11-hosted-final-2026-10-04.json`

Earlier evidence remains historical with its original source and outcome;
records captured while CI/review were pending are not rewritten as final runs.

## Boundaries and continuation

Network peers in local acceptance run on the same PC. That proves the private
interface/session implementation and actual compiled client integration, not
remote Quest hardware. Portable runtime uses a debugger-injected hidden-window
and isolated-profile wrapper; executable, ASAR and native DLLs remain unchanged.
The participant's accepted portable and profile remain intact. No merge or
public release was performed.

Phase 12 continues with Unity Quest 3. Unity Personal is activated. Unity
6000.3.25f1 builds an owned ARM64 IL2CPP toolchain fixture, and a separate
compatibility probe runs shared managed models in the Unity Editor and compiles
them into ARM64. Those fixtures are not the Quest CAD product and have not been
installed on a headset. Actual binary mesh transport, XR scene, MR placement
and the complete hardware acceptance remain Phase 12 work.
