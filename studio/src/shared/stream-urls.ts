/**
 * Where each flavour of server exposes its streams.
 *
 * Frigate embeds go2rtc and proxies it under `/live/webrtc`. Measured against
 * Frigate 0.17.1: `/live/webrtc/api/ws` answers 400 without an Upgrade header
 * (i.e. it is a live WebSocket endpoint), while `/live/webrtc/api/whep` answers
 * 405 and `/api/go2rtc/api/whep` answers 403 -- so WHEP is not available there
 * and WebSocket signalling is the transport that actually works on both.
 */
import type { MediaServer } from './types';

function base(server: MediaServer): string {
  return server.url.replace(/\/+$/, '');
}

/** go2rtc WebSocket signalling endpoint for a camera. */
export function signallingUrl(server: MediaServer, camera: string): string {
  const root = base(server).replace(/^http(s?):\/\//i, (_m, s: string) => `ws${s}://`);
  const cam = encodeURIComponent(camera);
  return server.kind === 'frigate'
    ? `${root}/live/webrtc/api/ws?src=${cam}`
    : `${root}/api/ws?src=${cam}`;
}

/** Multipart MJPEG endpoint for a camera. */
export function mjpegUrl(server: MediaServer, camera: string): string {
  const root = base(server);
  const cam = encodeURIComponent(camera);
  return server.kind === 'frigate' ? `${root}/api/${cam}` : `${root}/api/frame.mjpeg?src=${cam}`;
}

/** Where the camera list comes from. */
export function camerasUrl(server: MediaServer): string {
  const root = base(server);
  return server.kind === 'frigate' ? `${root}/api/config` : `${root}/api/streams`;
}
