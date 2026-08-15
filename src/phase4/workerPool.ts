/**
 * Phase 4 — bounded worker pool (§15).
 *
 * Domains are independent and may run concurrently, but parallelism is bounded
 * and configurable. The pool runs up to `limit` tasks at once, preserves
 * completion order for result collection, and reports per-item transitions so
 * the generation state machine can be tracked.
 */

export type PoolProgressListener<T> = (item: T, state: "STARTED" | "COMPLETED" | "FAILED") => void;

export interface PoolOptions {
  /** Maximum number of concurrent tasks. Must be >= 1. */
  limit: number;
  onProgress?: PoolProgressListener<unknown>;
}

export interface PoolOutcome<T> {
  results: T[];
  failures: { item: unknown; error: unknown }[];
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  task: (item: T, index: number) => Promise<R>,
  options: PoolOptions,
): Promise<PoolOutcome<R>> {
  const limit = Math.max(1, Math.floor(options.limit));
  const results = new Array<R>(items.length);
  const failures: { item: T; error: unknown }[] = [];
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      const item = items[index] as T;
      options.onProgress?.(item, "STARTED");
      try {
        results[index] = await task(item, index);
        options.onProgress?.(item, "COMPLETED");
      } catch (error) {
        failures.push({ item, error });
        options.onProgress?.(item, "FAILED");
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);

  return {
    results: results.filter((r) => r !== undefined),
    failures,
  };
}