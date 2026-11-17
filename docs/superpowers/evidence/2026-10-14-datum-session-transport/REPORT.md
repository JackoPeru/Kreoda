# Datum session transport — Task3 partial

Root continues user-authorized quota fallback. Original full Phases12–16 goal unchanged. No Hermes/server/SSH/AI probe, remote change, device install/capture, microphone/camera/audio or foreground GUI.

Actual RED tests showed reducer rejection of datum patches, generic frame validation accepting malformed vectors, managed model lacking a datum collection, and relay local recovery snapshots discarding native datums.

Authored session-control-v1.json now contains typed datum descriptor variants, canonical definitions, resolved plane/axis/point geometry and full SketchPlaneFrame. Definition JSON was produced by the standard converter from existing canonical Zod; a test asserts exact equality with exported command definitions to prevent drift. Existing generator emits all5TS/C# artifacts from43DTO schemas; --check confirms fc27989e... source hash. No hand-edited generated files. Legacy snapshots may omit datums.

TS ordered reducer recognizes datum additions/updates/removals and rejects full datum arrays smuggled into incremental events. Managed SessionModelState adds init Datums with empty legacy default, preserving its existing six positional constructor arguments. Snapshot and delta readers retain definition/resolved geometry/support metadata, with normal lineage/gap/recovery behavior unchanged.

Relay core/local/network/committed snapshots and incremental events retain datums independently of solids. Normalized sketch context preserves native plane, supportRef and model. Create/edit/Undo semantic datum patches do not request mesh or change body collections. getFeatures context includes datums; new getDatum read-only query delegates native getDatum and validates its authoritative descriptor. All native frame and actual geometry remain core-owned.

Protocol51/51, canonical catalog19/19, focused session/context/body77/77. Managed actual runner141+33+32+33=239, zero failures/skips; release netstandard2.1 targets built. Runner independently checked per-suite TRX then deleted temporary results; exact counters retained in raw log, focused managed7TRX included. Desktop first default parallel run240passed/1Windows ACL persistence timeout; unchanged isolated12passed and complete --maxWorkers=2 run241/241passed across38files. No timeout suppressions or production credential changes. TypeScript check and generated drift check passed.

This uses a fake framed sidecar for transport tests; actual integrated native client/MCP and crash recovery proof remain. Desktop controls/rendering/selection, Quest full-frame/hand/semantic views, normal ARM64, exact current-head CI, fresh review and physical/live acceptance remain. No full Phase15.1 acceptance or merge/release claim.
