# Corrected trim packet review: remaining save retry race

Fresh reviewer01a1400c-3f16-7701-8832-885e11bc8299, actual GPT-6-Sol/high, reviewed accumulated immutablee4edeea..83bf84c55bc120fbaccb2f7c9b210754fa8b4393 and returned fix-first. Parent observed unchanged source hashes and a clean candidate before/after review. Reviewer remained behaviorally read-only under the observed danger-full-access/disabled-profile/approval-never environment; no enforced sandbox is claimed.

The trimmed native spline correction and recorded255/255 gates matched the packet. Two bounded Windows save issues remain:

1. The immediate-retry flag is not reset when a later probe observes a genuine delete-sharing lock. After a clear/retry, locked/wait, clear/unlocked sequence the old flag can stop publication prematurely despite time remaining. Reset the allowance after a locked observation; consecutive clear probes after repeated failures still stop as permanent.
2. The permanent-error integration tests time the entire SaveDocument path and require less than150ms, so serialization speed can fail an otherwise correct no-wait policy. Verify retry decisions deterministically and retain real read-only/directory failure/data-preservation coverage without that whole-save speed assertion.

Parent verified the actual helper and assertions, then resumed the SAME GPT-6-Luna/Max worker with ownership restricted to dispatcher.cpp and test_torture_phase10.cpp. One small new internal protocol/save_publish_retry.h is explicitly allowed if needed to expose the real retry decision policy for a deterministic sequence regression. No generic I/O framework or test-only production hooks. Existing actual Windows native-handle tests,200ms overall retry bound, no destination deletion/payload rewrite and non-Windows behavior must remain intact.

Required new behavioral RED/GREEN, full native build/CTest/runtime gate, independent parent verification and NEW fresh immutable review remain prerequisites for acceptance. Native associative lifecycle and original Phases12–16 scope remain required. No new source is pushed or covered by published9df evaluator CI yet.
