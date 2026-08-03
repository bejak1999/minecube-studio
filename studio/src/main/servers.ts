/**
 * Fetching camera lists from go2rtc and Frigate.
 *
 * This runs in the main process on purpose: `net.fetch` is not subject to CORS,
 * so a LAN server that sends no CORS headers still works. WebRTC signalling
 * does not come through here -- a WebSocket has no CORS problem, so the
 * renderer talks to the server directly (see render/sources/stream.ts).
 */
import { net } from 'electron';

import { camerasUrl } from '@shared/stream-urls';
import type { CameraEntry, MediaServer } from '@shared/types';

export async function listCameras(server: MediaServer): Promise<CameraEntry[]> {
  if (!server.url) throw new Error('Keine Server-URL gesetzt');

  const url = camerasUrl(server);
  const res = await net.fetch(url);
  if (!res.ok) throw new Error(`${server.name}: HTTP ${res.status} von ${url}`);

  if (server.kind === 'frigate') {
    const cfg = (await res.json()) as { cameras?: Record<string, unknown> };
    return Object.keys(cfg.cameras ?? {})
      .sort()
      .map((name) => ({ name, label: name }));
  }

  const streams = (await res.json()) as Record<string, unknown>;
  return Object.keys(streams)
    .sort()
    .map((name) => ({ name, label: name }));
}
