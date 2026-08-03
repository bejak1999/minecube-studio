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

export async function fetchLhmSensors(url: string): Promise<LhmSensor[]> {
  const base = url.replace(/\/+$/, '');
  const res = await net.fetch(`${base}/data.json`);
  if (!res.ok) throw new Error(`LibreHardwareMonitor antwortete mit HTTP ${res.status}`);
  return flattenLhmTree((await res.json()) as LhmNode);
}
