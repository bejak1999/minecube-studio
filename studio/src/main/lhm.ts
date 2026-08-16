/**
 * Fetches LibreHardwareMonitor's web-server JSON.
 *
 * Enable it in LHM under Options > Remote Web Server, default port 8085. The
 * tree-walking and locale-aware number parsing live in shared/lhm-parse.ts,
 * kept Electron-free so they can be unit tested; this file is the thin,
 * untested `net.fetch` wrapper around it.
 */
import { net } from 'electron';

import { flattenLhmTree, type LhmNode, type LhmSensor } from '@shared/lhm-parse';

/**
 * This is polled once a second behind a `busy` guard, so a request that never
 * settles would not just lose one sample -- it would wedge the guard and stop
 * *every* metric, dashboards included, until the app was restarted. A machine
 * that just woke up with its network still coming back is exactly when that
 * happens, so the request always has to be able to give up. LHM is a local
 * server; anything past a couple of seconds is not coming.
 */
const LHM_TIMEOUT_MS = 3000;

export async function fetchLhmSensors(url: string): Promise<LhmSensor[]> {
  const base = url.replace(/\/+$/, '');
  const res = await net.fetch(`${base}/data.json`, { signal: AbortSignal.timeout(LHM_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`LibreHardwareMonitor antwortete mit HTTP ${res.status}`);
  return flattenLhmTree((await res.json()) as LhmNode);
}
