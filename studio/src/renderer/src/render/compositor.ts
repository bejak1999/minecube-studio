/**
 * Draws a source into one panel's 720x720 canvas.
 *
 * The canvas doubles as the texture for the 3D cube preview, so what you see on
 * screen is literally the bytes that go to the panel.
 */
import type { CropRect, Dashboard, PanelViewport, SourceConfig } from '@shared/types';
import { PANEL_HEIGHT, PANEL_WIDTH } from '@shared/types';

import { renderDashboard } from './dashboard/render';
import type { FrameSource } from './sources/types';

export type Overlay = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

interface Placement {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * Map a source rectangle onto the panel.
 *
 * `cover` crops the source to the panel's aspect, `contain` letterboxes it,
 * `stretch` distorts. The panel is square, so `cover` is the usual choice.
 */
function place(
  srcX: number,
  srcY: number,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  fit: SourceConfig['fit'],
): Placement {
  if (fit === 'stretch' || srcW <= 0 || srcH <= 0) {
    return { sx: srcX, sy: srcY, sw: srcW, sh: srcH, dx: 0, dy: 0, dw: dstW, dh: dstH };
  }

  const srcAspect = srcW / srcH;
  const dstAspect = dstW / dstH;

  if (fit === 'contain') {
    const scale = Math.min(dstW / srcW, dstH / srcH);
    const dw = srcW * scale;
    const dh = srcH * scale;
    return { sx: srcX, sy: srcY, sw: srcW, sh: srcH, dx: (dstW - dw) / 2, dy: (dstH - dh) / 2, dw, dh };
  }

  // cover: take the largest centred sub-rectangle with the panel's aspect
  let sw = srcW;
  let sh = srcH;
  if (srcAspect > dstAspect) sw = srcH * dstAspect;
  else sh = srcW / dstAspect;

  return {
    sx: srcX + (srcW - sw) / 2,
    sy: srcY + (srcH - sh) / 2,
    sw,
    sh,
    dx: 0,
    dy: 0,
    dw: dstW,
    dh: dstH,
  };
}

export class PanelCanvas {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** Everything that would change the output; a redraw happens only when it does. */
  private lastKey = '';

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = PANEL_WIDTH;
    this.canvas.height = PANEL_HEIGHT;
    const ctx = this.canvas.getContext('2d', { alpha: false, willReadFrequently: false });
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT);
  }

  /** Force the next {@link draw} to repaint even if nothing else changed. */
  invalidate(): void {
    this.lastKey = '';
  }

  /**
   * Repaint if needed. Returns true when the canvas actually changed, which is
   * the signal to re-encode and push a frame.
   */
  draw(
    source: FrameSource,
    viewport: PanelViewport,
    fit: SourceConfig['fit'],
    crop: CropRect,
    sourceRotate?: 0 | 90 | 180 | 270,
    overlay?: Overlay,
    overlayKey?: string,
    dashboardOverlay?: Dashboard | null,
  ): boolean {
    const key = [
      source.revision,
      viewport.x,
      viewport.y,
      viewport.w,
      viewport.h,
      viewport.rotate,
      viewport.flipH,
      viewport.flipV,
      fit,
      crop.x,
      crop.y,
      crop.w,
      crop.h,
      sourceRotate,
      overlayKey,
      // Only the identity needs to be in the key -- the redraw-on-metrics-tick
      // that keeps the widget *values* fresh comes from Pipeline calling
      // invalidate() on every tick, not from anything captured here.
      dashboardOverlay?.id ?? '',
    ].join('|');
    if (this.lastKey === key) return false;
    this.lastKey = key;

    const { ctx } = this;
    const w = PANEL_WIDTH;
    const h = PANEL_HEIGHT;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    // Rotation and mirroring happen around the panel centre.
    ctx.translate(w / 2, h / 2);
    if (viewport.rotate) ctx.rotate((viewport.rotate * Math.PI) / 180);
    if (sourceRotate) ctx.rotate((sourceRotate * Math.PI) / 180);
    ctx.scale(viewport.flipH ? -1 : 1, viewport.flipV ? -1 : 1);
    ctx.translate(-w / 2, -h / 2);

    const frame = source.frame;
    const size = source.size;
    if (frame && size && size.w > 0 && size.h > 0) {
      // The crop picks the region of interest out of the source; the viewport
      // then subdivides that region across panels in unified mode. In
      // individual mode the viewport is the full rectangle, so region == crop.
      const regionX = (crop.x + viewport.x * crop.w) * size.w;
      const regionY = (crop.y + viewport.y * crop.h) * size.h;
      const regionW = viewport.w * crop.w * size.w;
      const regionH = viewport.h * crop.h * size.h;
      const p = place(regionX, regionY, regionW, regionH, w, h, fit);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      try {
        ctx.drawImage(frame, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.dw, p.dh);
      } catch {
        // A video can throw while it has no decoded frame yet; black is fine.
      }
    }
    ctx.restore();

    // Both overlays are drawn in panel screen space, outside the content's own
    // rotation transform -- a HUD stays upright and in the same corner
    // regardless of how the underlying source is rotated for mounting.
    if (dashboardOverlay) {
      ctx.save();
      renderDashboard(ctx, dashboardOverlay, w);
      ctx.restore();
    }
    if (overlay) {
      ctx.save();
      overlay(ctx, w, h);
      ctx.restore();
    }
    return true;
  }

  /** Encode the current canvas as a baseline JPEG the panel accepts. */
  encode(quality: number): Promise<Blob | null> {
    return new Promise((resolve) => {
      this.canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
    });
  }
}
