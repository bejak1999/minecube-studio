/**
 * Desktop screen capture source.
 *
 * Uses Electron's desktopCapturer (exposed through the preload bridge) to grab
 * a live feed of a monitor. The stream is fed into a <video> element so the
 * pipeline can draw it onto the panels just like a camera stream.
 */
import type { SourceConfig } from '@shared/types';

import { stage, unstage } from '../staging';
import type { FrameSource } from './types';

export class DesktopSource implements FrameSource {
  readonly kind = 'desktop' as const;
  size: { w: number; h: number } | null = null;
  revision = 0;
  frame: HTMLVideoElement | null = null;
  error: string | null = null;

  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private handle: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(private readonly config: SourceConfig) {}

  async start(): Promise<void> {
    const sourceId = this.config.desktopSourceId;
    if (!sourceId) {
      this.error = 'Kein Bildschirm ausgewählt';
      return;
    }

    try {
      // Electron exposes chromeMediaSource constraints for desktopCapturer
      this.stream = await (navigator.mediaDevices as any).getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            minFrameRate: 15,
          },
        },
      });
    } catch (err) {
      this.error = `Bildschirm konnte nicht aufgenommen werden: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }

    const video = stage(document.createElement('video'));
    this.video = video;
    video.autoplay = true;
    video.srcObject = this.stream;
    video.muted = true;
    video.playsInline = true;

    await new Promise<void>((resolve) => {
      video.onloadeddata = () => {
        this.size = { w: video.videoWidth, h: video.videoHeight };
        this.frame = video;
        resolve();
      };
      video.onerror = () => {
        this.error = 'Videostream konnte nicht gestartet werden';
        resolve();
      };
      // Timeout fallback
      window.setTimeout(() => {
        if (!this.frame) {
          this.error = 'Kein Bild innerhalb von 5 Sekunden';
        }
        resolve();
      }, 5000);
    });

    try {
      await video.play();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      return;
    }

    // Use setInterval so it keeps ticking when minimized
    this.handle = setInterval(() => {
      if (this.stopped || !this.video) return;
      this.size = { w: this.video.videoWidth, h: this.video.videoHeight };
      this.revision++;
    }, 33);
  }

  stop(): void {
    this.stopped = true;
    if (this.handle != null) {
      clearInterval(this.handle);
      this.handle = null;
    }
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
      unstage(this.video);
      this.video = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    this.frame = null;
  }
}
