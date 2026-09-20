// Bounded-parallel task pool (Phase 8 large-model slice).
// Mesh hydration fans out over IPC: unbounded Promise.all would burst the
// sidecar pipe, sequential await costs one round-trip per feature.
// Order of results matches input order; the first rejection wins (same
// fail-fast semantics as the sequential loop it replaces).

export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  if (items.length === 0) return out;
  // Clamp garbage limits (M9): NaN/negative/zero would spawn zero workers
  // and return a holes array with no work ever done.
  const sane = Number.isFinite(limit) ? Math.floor(limit) : 8;
  const workers = Math.max(1, Math.min(sane, items.length));
  let next = 0;
  let failed: unknown = null;
  let hasFailed = false;
  const worker = async (): Promise<void> => {
    while (true) {
      if (hasFailed) return;
      const i = next++;
      if (i >= items.length) return;
      try {
        out[i] = await fn(items[i]!, i);
      } catch (e) {
        if (!hasFailed) {
          hasFailed = true;
          failed = e;
        }
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: workers }, () => worker()));
  if (hasFailed) throw failed;
  return out;
}
