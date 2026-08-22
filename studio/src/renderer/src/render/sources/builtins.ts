/** Nothing, a colour, a still image, an animation, a video file, a live stream. */
import type { SourceConfig } from '@shared/types';

import { stage, toMediaUrl, unstage } from '../staging';
import { DesktopSource } from './desktop';
import { AnimatedImageSource } from './gif';
import { StreamSource } from './stream';
import { registerSource, type FrameSource } from './types';

/**
 * Normalise a CSS colour, or null if the browser cannot parse it.
 *
 * Assigning an invalid value to `fillStyle` is a no-op, so probe twice from
 * different starting points: only a value the parser accepted makes both agree.
 */
function parseColor(value: string | undefined): string | null {
  if (!value) return null;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#000000';
  ctx.fillStyle = value;
  const fromBlack = ctx.fillStyle;
  ctx.fillStyle = '#ffffff';
  ctx.fillStyle = value;
  return fromBlack === ctx.fillStyle ? fromBlack : null;
}

/**
 * How long a media element may claim to be playing without the picture
 * actually moving before it is treated as stalled and nudged.
 */
const STALL_MS = 3000;

/** Blank panel. Also the fallback while a slot is unassigned. */
class NoneSource implements FrameSource {
  readonly kind = 'none' as const;
  readonly size = null;
  readonly revision = 0;
  readonly frame = null;
  readonly error = null;
  async start(): Promise<void> {}
  stop(): void {}
}

/** A flat colour, rasterised once into a 1x1 canvas the compositor can stretch. */
class ColorSource implements FrameSource {
  readonly kind = 'color' as const;
  readonly size = { w: 1, h: 1 };
  revision = 0;
  frame: HTMLCanvasElement | null = null;
  error: string | null = null;

  constructor(private readonly config: SourceConfig) {}

  async start(): Promise<void> {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d')!;

    // An unparseable colour leaves fillStyle untouched, which would silently
    // paint black -- indistinguishable from "nothing works". Detect it.
    const parsed = parseColor(this.config.color);
    if (!parsed) {
      this.error = `Ungültige Farbe: ${this.config.color ?? '(nicht gesetzt)'}`;
    }
    ctx.fillStyle = parsed ?? '#ff00ff'; // magenta shouts louder than black
    ctx.fillRect(0, 0, 1, 1);
    this.frame = canvas;
    this.revision++;
  }

  stop(): void {
    this.frame = null;
  }
}

/** A still image. Animated formats go through {@link AnimatedImageSource}. */
class ImageSource implements FrameSource {
  readonly kind = 'image' as const;
  size: { w: number; h: number } | null = null;
  revision = 0;
  frame: HTMLImageElement | null = null;
  error: string | null = null;

  private el: HTMLImageElement | null = null;

  constructor(private readonly config: SourceConfig) {}

  async start(): Promise<void> {
    const el = stage(document.createElement('img'));
    this.el = el;
    el.decoding = 'async';

    await new Promise<void>((resolve) => {
      el.onload = () => {
        this.size = { w: el.naturalWidth, h: el.naturalHeight };
        this.frame = el;
        this.revision++;
        resolve();
      };
      el.onerror = () => {
        this.error = `Bild konnte nicht geladen werden: ${this.config.src ?? '(leer)'}`;
        resolve();
      };
      el.src = toMediaUrl(this.config.src ?? '');
    });
  }

  stop(): void {
    if (this.el) unstage(this.el);
    this.el = null;
    this.frame = null;
  }
}

/**
 * A video file.
 *
 * `requestVideoFrameCallback` fires exactly once per decoded frame, so the
 * pipeline re-encodes at the video's own rate instead of guessing.
 */
class VideoSource implements FrameSource {
  readonly kind = 'video' as const;
  size: { w: number; h: number } | null = null;
  revision = 0;
  frame: HTMLVideoElement | null = null;
  error: string | null = null;
  finished = false;

  private el: HTMLVideoElement | null = null;
  private handle: ReturnType<typeof setInterval> | null = null;
  private audioCtx: AudioContext | null = null;
  private audioSrc: MediaElementAudioSourceNode | null = null;
  private gain: GainNode | null = null;

  constructor(private readonly config: SourceConfig) {}

  async start(): Promise<void> {
    const el = stage(document.createElement('video'));
    this.el = el;
    el.loop = this.config.loop ?? true;
    // Only a non-looping video can ever finish; the carousel turns looping off.
    el.onended = () => {
      this.finished = true;
    };
    el.playsInline = true;
    el.playbackRate = this.config.rate ?? 1;
    el.preload = 'auto';

    // Web Audio trick: route audio through an AudioContext to force Chromium
    // to keep decoding the video in the background to maintain A/V sync.
    this.audioCtx = new AudioContext();
    this.audioSrc = this.audioCtx.createMediaElementSource(el);
    this.gain = this.audioCtx.createGain();
    // Mute via GainNode instead of video.muted so Chromium processes the audio graph
    this.gain.gain.value = (this.config.muted ?? true) ? 0 : 1;
    this.audioSrc.connect(this.gain);
    this.gain.connect(this.audioCtx.destination);
    
    // Video must be unmuted so the AudioContext receives the stream!
    el.muted = false;

    await new Promise<void>((resolve) => {
      el.onloadeddata = () => {
        this.size = { w: el.videoWidth, h: el.videoHeight };
        this.frame = el;
        resolve();
      };
      el.onerror = () => {
        this.error = `Video konnte nicht geladen werden: ${this.config.src ?? '(leer)'}`;
        resolve();
      };
      el.src = toMediaUrl(this.config.src ?? '');
    });

    if (this.error) return;
    try {
      await el.play();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      return;
    }
    this.scheduleFrameCallback();
  }

  private scheduleFrameCallback(): void {
    if (!this.el) return;
    // Chromium pauses requestVideoFrameCallback and requestAnimationFrame
    // when the window is minimized. We poll instead so the pipeline keeps
    // receiving frames.
    let lastNudge = 0;
    let lastTime = -1;
    let progressedAt = Date.now();
    let stallRecoveries = 0;

    this.handle = setInterval(() => {
      const el = this.el;
      if (!el || el.ended) return;

      if (el.paused) {
        // Nothing here pauses deliberately except stop(), which also clears
        // this interval -- so a paused element means Chromium stopped it by
        // itself, which it does under memory pressure and around sleep.
        // Without nudging it the panel sits on its last decoded frame for good.
        if (Date.now() - lastNudge >= 1000) {
          lastNudge = Date.now();
          void el.play().catch(() => undefined);
        }
        return;
      }

      if (el.currentTime !== lastTime) {
        lastTime = el.currentTime;
        progressedAt = Date.now();
        stallRecoveries = 0;
        this.revision++;
        return;
      }

      // Playing, but the picture is not moving: the decoder has stalled. That
      // happens when something else on the machine is hammering the GPU. The
      // element still reports itself as playing, so the check above never
      // fires, and the panel would hold this one frame indefinitely while
      // anything drawn over it -- a dashboard overlay, say -- kept updating.
      if (Date.now() - progressedAt < STALL_MS || Date.now() - lastNudge < STALL_MS) return;
      lastNudge = Date.now();
      stallRecoveries++;
      if (stallRecoveries <= 2) {
        // A tiny seek is usually enough to get the decoder producing again.
        try {
          el.currentTime += 0.001;
        } catch {
          // not seekable yet
        }
      } else {
        // Still stuck after repeated nudges: rebuild the element's pipeline.
        el.load();
        void el.play().catch(() => undefined);
        stallRecoveries = 0;
      }
    }, 33);
  }

  stop(): void {
    const el = this.el;
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
      unstage(el);
    }
    if (this.handle !== null) {
      clearInterval(this.handle);
      this.handle = null;
    }
    
    if (this.audioSrc) this.audioSrc.disconnect();
    if (this.gain) this.gain.disconnect();
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      void this.audioCtx.close();
    }
    this.audioSrc = null;
    this.gain = null;
    this.audioCtx = null;
    
    this.el = null;
    this.frame = null;
  }
}

export function registerBuiltinSources(): void {
  registerSource('none', () => new NoneSource());
  registerSource('color', (config) => new ColorSource(config));
  registerSource('image', (config) => new ImageSource(config));
  registerSource('gif', (config) => new AnimatedImageSource(config.src));
  registerSource('video', (config) => new VideoSource(config));
  registerSource(
    'stream',
    (config, ctx) => new StreamSource(config, ctx.servers.find((s) => s.id === config.serverId)),
  );
  // Statically imported on purpose: `require` is undefined in the renderer (it
  // is an ESM bundle), so a lazy require here threw as soon as a panel was set
  // to "Bildschirm". desktop.ts pulls in nothing main-process-only, so there is
  // nothing to keep out of the chunk.
  registerSource('desktop', (config) => new DesktopSource(config));
}
