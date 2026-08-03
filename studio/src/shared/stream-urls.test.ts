import { describe, expect, it } from 'vitest';

import { camerasUrl, mjpegUrl, signallingUrl } from './stream-urls';
import type { MediaServer } from './types';

const frigate: MediaServer = {
  id: 'f',
  name: 'Frigate',
  kind: 'frigate',
  url: 'http://192.168.1.10:5000',
};
const go2rtc: MediaServer = { id: 'g', name: 'go2rtc', kind: 'go2rtc', url: 'http://10.0.0.5:1984' };

describe('stream urls', () => {
  it('points Frigate WebRTC at the proxied go2rtc WebSocket', () => {
    // Verified against Frigate 0.17.1: this path answers, /api/whep does not.
    expect(signallingUrl(frigate, 'front_door')).toBe(
      'ws://192.168.1.10:5000/live/webrtc/api/ws?src=front_door',
    );
  });

  it('points go2rtc WebRTC at its own WebSocket', () => {
    expect(signallingUrl(go2rtc, 'cam1')).toBe('ws://10.0.0.5:1984/api/ws?src=cam1');
  });

  it('upgrades https to wss', () => {
    expect(signallingUrl({ ...frigate, url: 'https://cam.example.com' }, 'a')).toBe(
      'wss://cam.example.com/live/webrtc/api/ws?src=a',
    );
  });

  it('uses each server’s MJPEG endpoint', () => {
    expect(mjpegUrl(frigate, 'backyard')).toBe('http://192.168.1.10:5000/api/backyard');
    expect(mjpegUrl(go2rtc, 'cam1')).toBe('http://10.0.0.5:1984/api/frame.mjpeg?src=cam1');
  });

  it('uses each server’s camera list endpoint', () => {
    expect(camerasUrl(frigate)).toBe('http://192.168.1.10:5000/api/config');
    expect(camerasUrl(go2rtc)).toBe('http://10.0.0.5:1984/api/streams');
  });

  it('tolerates a trailing slash and escapes camera names', () => {
    expect(mjpegUrl({ ...frigate, url: 'http://host:5000/' }, 'Hof Süd')).toBe(
      'http://host:5000/api/Hof%20S%C3%BCd',
    );
  });
});
