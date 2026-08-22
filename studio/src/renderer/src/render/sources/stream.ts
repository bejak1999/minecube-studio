/**
 * Live camera streams from go2rtc or Frigate.
 *
 * Two transports:
 *
 * - **WebRTC** over go2rtc's WebSocket signalling. Lowest latency, and a
 *   MediaStream never taints the canvas. A WebSocket is not subject to CORS, so
 *   the renderer talks to the server directly.
 * - **MJPEG** -- works with anything, proxied through the `media://` scheme so
 *   the response carries CORS headers and the canvas stays encodable. Without
 *   that detour the canvas would be tainted and `toBlob` would throw, leaving
 *   nothing to send.
 */
import { mjpegUrl, signallingUrl } from '@shared/stream-urls';
import type { MediaServer, SourceConfig, StreamMode } from '@shared/types';

import { stage, unstage } from '../staging';
import type { FrameSource } from './types';

/** Mirrors main/media-protocol.ts `toProxyUrl`. */
function proxied(url: string): string {
  return `media://proxy/${encodeURIComponent(url)}`;
}

const CONNECT_TIMEOUT_MS = 8000;

/**
 * How long the picture may sit still while the element still claims to be
 * playing before the transport is treated as dead. Generous: a low-framerate
 * camera is normal, a camera that has not advanced at all for this long is not.
 */
const STALL_MS = 10000;

export class StreamSource implements FrameSource {
  readonly kind = 'stream' as const;
  size: { w: number; h: number } | null = null;
  revision = 0;
  frame: HTMLVideoElement | HTMLImageElement | null = null;
  error: string | null = null;

  private video: HTMLVideoElement | null = null;
  private img: HTMLImageElement | null = null;
  private pc: RTCPeerConnection | null = null;
  private ws: WebSocket | null = null;
  private handle: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  /** Guards against a stall check firing another reconnect while one is in flight. */
  private restarting = false;

  constructor(
    private readonly config: SourceConfig,
    private readonly server: MediaServer | undefined,
  ) {}

  private get mode(): StreamMode {
    return this.config.streamMode ?? 'webrtc';
  }

  async start(): Promise<void> {
    if (!this.server) {
      this.error = 'Kein Server ausgewählt';
      return;
    }
    if (!this.config.camera) {
      this.error = 'Keine Kamera ausgewählt';
      return;
    }
    return this.mode === 'mjpeg' ? this.startMjpeg() : this.startWebrtc();
  }

  // -- MJPEG ---------------------------------------------------------------

  private async startMjpeg(): Promise<void> {
    const url = mjpegUrl(this.server!, this.config.camera!);
    const img = stage(document.createElement('img'));
    this.img = img;
    // The proxy adds Access-Control-Allow-Origin, so this does not taint.
    img.crossOrigin = 'anonymous';

    await new Promise<void>((resolve) => {
      let settled = false;
      const done = (): void => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      img.onload = () => {
        this.size = { w: img.naturalWidth, h: img.naturalHeight };
        this.frame = img;
        done();
      };
      img.onerror = () => {
        this.error = `MJPEG nicht erreichbar: ${url}`;
        done();
      };
      img.src = proxied(url);
      // Some servers never complete the first multipart part; do not block.
      window.setTimeout(done, CONNECT_TIMEOUT_MS / 2);
    });

    if (this.error) return;

    // Nothing signals a new MJPEG part, so mark dirty on a short interval and
    // let the pipeline's fps cap decide how often that actually costs anything.
    // setInterval keeps firing when the window is minimized, unlike rAF.
    this.handle = setInterval(() => {
      if (this.stopped) return;
      if (this.img && this.img.naturalWidth > 0) {
        this.size = { w: this.img.naturalWidth, h: this.img.naturalHeight };
        this.frame = this.img;
        this.revision++;
      }
    }, 33);
  }

  // -- WebRTC --------------------------------------------------------------

  private async startWebrtc(): Promise<void> {
    const url = signallingUrl(this.server!, this.config.camera!);
    const video = stage(document.createElement('video'));
    this.video = video;
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;

    // LAN only: no STUN, which also avoids waiting on an unreachable server.
    const pc = new RTCPeerConnection({ iceServers: [] });
    this.pc = pc;
    pc.addTransceiver('video', { direction: 'recvonly' });

    pc.ontrack = (event) => {
      video.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void video.play().catch(() => undefined);
    };

    const connected = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean, message?: string): void => {
        if (settled) return;
        settled = true;
        if (!ok && message) this.error = message;
        resolve(ok);
      };

      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onerror = () => finish(false, `WebSocket nicht erreichbar: ${url}`);
      ws.onclose = () => {
        if (!this.frame) finish(false, `Signalisierung abgebrochen: ${url}`);
      };

      ws.onopen = () => {
        pc.onicecandidate = (event) => {
          if (event.candidate && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'webrtc/candidate', value: event.candidate.candidate }));
          }
        };
        void (async () => {
          try {
            await pc.setLocalDescription(await pc.createOffer());
            ws.send(JSON.stringify({ type: 'webrtc/offer', value: pc.localDescription!.sdp }));
          } catch (err) {
            finish(false, `Angebot fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
          }
        })();
      };

      ws.onmessage = (event) => {
        let msg: { type?: string; value?: string };
        try {
          msg = JSON.parse(String(event.data)) as { type?: string; value?: string };
        } catch {
          return;
        }
        void (async () => {
          try {
            if (msg.type === 'webrtc/answer' && msg.value) {
              await pc.setRemoteDescription({ type: 'answer', sdp: msg.value });
            } else if (msg.type === 'webrtc/candidate' && msg.value) {
              await pc.addIceCandidate({ candidate: msg.value, sdpMid: '0' });
            } else if (msg.type === 'error') {
              finish(false, `Server: ${msg.value ?? 'unbekannter Fehler'}`);
            }
          } catch {
            // A late or duplicate candidate is not worth tearing the stream down.
          }
        })();
      };

      video.onloadeddata = () => {
        this.size = { w: video.videoWidth, h: video.videoHeight };
        this.frame = video;
        finish(true);
      };

      window.setTimeout(
        () => finish(false, `Kein Videobild innerhalb von ${CONNECT_TIMEOUT_MS / 1000}s`),
        CONNECT_TIMEOUT_MS,
      );
    });

    if (!connected) return;
    this.followFrames(video);
  }

  private followFrames(video: HTMLVideoElement): void {
    // Use setInterval instead of requestVideoFrameCallback / rAF so that
    // frame ticking continues when the Electron window is minimized.
    let lastNudge = 0;
    let lastTime = -1;
    let progressedAt = Date.now();

    this.handle = setInterval(() => {
      if (this.stopped) return;
      // Same as VideoSource: Chromium pauses media elements on its own under
      // memory pressure and around sleep, and a paused camera would leave the
      // panel drawing one stale frame forever.
      if (video.paused) {
        if (Date.now() - lastNudge >= 1000) {
          lastNudge = Date.now();
          void video.play().catch(() => undefined);
        }
      }

      if (video.currentTime !== lastTime) {
        lastTime = video.currentTime;
        progressedAt = Date.now();
      } else if (Date.now() - progressedAt >= STALL_MS) {
        // The picture has not moved for a long time. For a live camera that
        // means the peer connection is gone -- ICE gives up quietly, and
        // nothing here would ever notice: the element keeps reporting itself
        // as playing and the panel holds one frame forever. Rebuilding the
        // transport is the only way back.
        progressedAt = Date.now();
        void this.restart();
        return;
      }

      this.size = { w: video.videoWidth, h: video.videoHeight };
      this.revision++;
    }, 33);
  }

  /** Drop the transport without marking the source stopped, so it can be started again. */
  private teardown(): void {
    if (this.handle != null) {
      clearInterval(this.handle);
    }
    this.handle = null;

    this.ws?.close();
    this.ws = null;
    this.pc?.close();
    this.pc = null;

    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
      unstage(this.video);
      this.video = null;
    }
    if (this.img) {
      this.img.removeAttribute('src');
      unstage(this.img);
      this.img = null;
    }
    this.frame = null;
  }

  /**
   * Reconnect after the stream went dead underneath us.
   *
   * There is no reconnect anywhere else: the WebSocket and peer connection are
   * built once in start(), so a camera lost to a network blip, a server
   * restart or a sleep cycle stayed lost until the whole source was rebuilt
   * from outside.
   */
  private async restart(): Promise<void> {
    if (this.stopped || this.restarting) return;
    this.restarting = true;
    try {
      this.teardown();
      this.error = null;
      if (!this.stopped) await this.start();
    } catch {
      // start() records its own error; a failed attempt just means the next
      // stall check tries again.
    } finally {
      this.restarting = false;
    }
  }

  stop(): void {
    this.stopped = true;
    this.teardown();
  }
}
