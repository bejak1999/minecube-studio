/**
 * Renderer-side home for metrics snapshots pushed from the main process.
 *
 * Started lazily on first use (by whatever needs it first -- DashboardSource
 * or the editor's live preview) rather than at module load, the same way
 * VideoSource only creates its AudioContext once a video actually starts.
 */
import type { MetricDescriptor, MetricsSnapshot } from '@shared/types';

/** Seconds of history kept per metric, at the ~1/s tick rate -- plenty for a graph widget. */
const HISTORY_LEN = 120;

let latest: MetricsSnapshot = { at: 0, values: {} };
const history: Record<string, number[]> = {};
const listeners = new Set<() => void>();
let started = false;

function pushHistory(snapshot: MetricsSnapshot): void {
  for (const [key, value] of Object.entries(snapshot.values)) {
    const arr = history[key] ?? (history[key] = []);
    arr.push(value);
    if (arr.length > HISTORY_LEN) arr.shift();
  }
}

export function ensureMetricsStore(): void {
  if (started) return;
  started = true;
  window.minecube.onMetrics((snapshot) => {
    latest = snapshot;
    pushHistory(snapshot);
    for (const listener of listeners) listener();
  });
}

export function getMetricValue(key: string | undefined): number | undefined {
  return key ? latest.values[key] : undefined;
}

/** Oldest-to-newest, capped to `maxPoints`. */
export function getMetricHistory(key: string | undefined, maxPoints = HISTORY_LEN): number[] {
  if (!key) return [];
  const arr = history[key] ?? [];
  return maxPoints < arr.length ? arr.slice(arr.length - maxPoints) : arr;
}

/** Fires once per incoming snapshot. Returns an unsubscribe function. */
export function subscribeMetrics(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Descriptors for metrics that only exist at runtime -- LHM sensors and
 * per-drive disk stats -- so `metricUnit()` can resolve their unit from
 * inside render.ts, which has no access to the Pinia store. Kept in step by
 * `stores/studio.ts` the same way `render/dashboard/registry.ts` mirrors
 * saved dashboards.
 */
let extraDescriptors: MetricDescriptor[] = [];

export function setExtraMetricDescriptors(list: MetricDescriptor[]): void {
  extraDescriptors = list;
}

export function getExtraMetricDescriptors(): MetricDescriptor[] {
  return extraDescriptors;
}
