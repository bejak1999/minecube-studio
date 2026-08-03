/**
 * Animated images (GIF, animated WebP/AVIF), decoded frame by frame.
 *
 * An `<img>` cannot be used: Chromium only advances image animation for
 * elements it is actually painting, and ours live off-screen -- the result is a
 * still first frame. WebCodecs' ImageDecoder gives us the frames and, crucially,
 * each frame's own duration, so the animation runs at its authored speed
 * instead of at whatever rate the render loop happens to tick.
 */
import { toMediaUrl } from '../staging';
import type { FrameSource } from './types';

interface DecodedFrame {
  bitmap: ImageBitmap;
  /** Milliseconds this frame is shown. */
  durationMs: number;
}

/** GIF frames with a 0 or absurdly small delay are conventionally shown at 100 ms. */
const MIN_FRAME_MS = 20;
const DEFAULT_FRAME_MS = 100;

export class AnimatedImageSource implements FrameSource {
  readonly kind = 'gif' as const;
  size: { w: number; h: number } | null = null;
  revision = 0;
  frame: ImageBitmap | null = null;
  error: string | null = null;

  private frames: DecodedFrame[] = [];
  private index = 0;
  private timer: number | null = null;
  private stopped = false;

  constructor(private readonly src: string | undefined) {}

  async start(): Promise<void> {
    if (!this.src) {
      this.error = 'Keine Datei ausgewählt';
      return;
    }
    if (typeof ImageDecoder === 'undefined') {
      this.error = 'ImageDecoder wird von dieser Chromium-Version nicht unterstützt';
      return;
    }

    let buffer: ArrayBuffer;
    let type: string;
    try {
      const res = await fetch(toMediaUrl(this.src));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      type = res.headers.get('content-type') || 'image/gif';
      buffer = await res.arrayBuffer();
    } catch (err) {
      this.error = `Datei konnte nicht gelesen werden: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }

    try {
      // `type` from the server can be generic; fall back to the extension.
      if (!type.startsWith('image/')) {
        type = /\.webp$/i.test(this.src) ? 'image/webp' : 'image/gif';
      }
      const decoder = new ImageDecoder({ data: buffer, type });
      // Both awaits are needed, and in this order. `completed` alone leaves
      // `tracks` empty -- measured: tracks.length === 0, selectedTrack === null
      // -- so reading frameCount there silently yields one frame and the
      // animation comes out as a still.
      await decoder.tracks.ready;
      await decoder.completed;
      const track = decoder.tracks.selectedTrack;
      if (!track) throw new Error('kein Bild-Track gefunden');
      const count = track.frameCount;

      for (let i = 0; i < count && !this.stopped; i++) {
        const { image } = await decoder.decode({ frameIndex: i });
        const bitmap = await createImageBitmap(image);
        const micros = image.duration ?? 0;
        image.close();
        this.frames.push({
          bitmap,
          durationMs: micros > 0 ? Math.max(micros / 1000, MIN_FRAME_MS) : DEFAULT_FRAME_MS,
        });
      }
      decoder.close();
    } catch (err) {
      this.error = `Animation konnte nicht dekodiert werden: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }

    if (this.frames.length === 0) {
      this.error = 'Keine Einzelbilder gefunden';
      return;
    }

    const first = this.frames[0].bitmap;
    this.size = { w: first.width, h: first.height };
    this.show(0);
    if (this.frames.length > 1) this.schedule();
    else this.error = 'Nur ein Einzelbild — die Datei ist nicht animiert';
  }

  private show(index: number): void {
    this.index = index;
    this.frame = this.frames[index].bitmap;
    this.revision++;
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = window.setTimeout(() => {
      this.show((this.index + 1) % this.frames.length);
      this.schedule();
    }, this.frames[this.index].durationMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.frame = null;
    for (const f of this.frames) f.bitmap.close();
    this.frames = [];
  }
}
