/**
 * Draws a Dashboard onto a 2D context.
 *
 * Deliberately shared, unmodified, between the panel-facing DashboardSource and
 * the editor's live preview: what you design is exactly what the pipeline
 * encodes, the same principle already used for PanelCanvas. A dashboard is
 * always an overlay -- see SlotConfig.overlayDashboardId -- so this never
 * paints a background of its own; whatever the panel already shows stays
 * visible in the gaps, in the editor preview too.
 */
import { applyUnit, BUILTIN_METRICS, formatMetric, getUnitOptions } from '@shared/metrics-catalog';
import type { Dashboard, DashboardWidget } from '@shared/types';

import { toMediaUrl } from '../staging';
import { getExtraMetricDescriptors, getMetricHistory, getMetricValue } from '../metrics-store';

/** Resolves a widget's displayed value + unit, honouring its unit override and LHM/disk descriptors alike. */
function displayValue(widget: DashboardWidget): { value: number | undefined; unit: string } {
  const catalog = [...BUILTIN_METRICS, ...getExtraMetricDescriptors()];
  return applyUnit(widget.metric, getMetricValue(widget.metric), widget.unit, catalog);
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function boxOf(widget: DashboardWidget, size: number): Box {
  return { x: widget.x * size, y: widget.y * size, w: widget.w * size, h: widget.h * size };
}

function roundRectPath(ctx: CanvasRenderingContext2D, box: Box, radius: number): void {
  ctx.beginPath();
  const r = Math.max(0, Math.min(radius, box.w / 2, box.h / 2));
  ctx.roundRect(box.x, box.y, box.w, box.h, r);
}

/** Fills+strokes a shape traced by `trace()` with the widget's bg/border style, independent of the widget's overall opacity. */
function fillAndStroke(ctx: CanvasRenderingContext2D, style: DashboardWidget['style'], trace: () => void): void {
  if (style.bgColor) {
    trace();
    ctx.save();
    ctx.globalAlpha = style.bgOpacity ?? 1;
    ctx.fillStyle = style.bgColor;
    ctx.fill();
    ctx.restore();
  }
  if (style.borderColor && style.borderWidth > 0) {
    trace();
    ctx.strokeStyle = style.borderColor;
    ctx.lineWidth = style.borderWidth;
    ctx.stroke();
  }
}

function drawPanel(ctx: CanvasRenderingContext2D, widget: DashboardWidget, box: Box): void {
  fillAndStroke(ctx, widget.style, () => roundRectPath(ctx, box, widget.style.borderRadius));
}

function drawText(ctx: CanvasRenderingContext2D, widget: DashboardWidget, box: Box): void {
  drawPanel(ctx, widget, box);
  const { style } = widget;
  const { value, unit } = displayValue(widget);
  const text = widget.metric ? formatMetric(value, unit, widget.decimals ?? 0, widget.format) : widget.text || '';

  ctx.save();
  ctx.globalAlpha = style.opacity;
  ctx.textAlign = style.align;
  ctx.textBaseline = 'middle';
  const tx = style.align === 'left' ? box.x + 10 : style.align === 'right' ? box.x + box.w - 10 : box.x + box.w / 2;

  if (widget.label) {
    ctx.font = `500 ${style.labelFontSize}px system-ui, sans-serif`;
    ctx.fillStyle = style.labelColor;
    ctx.fillText(widget.label, tx, box.y + box.h * 0.28);
    ctx.font = `${style.fontWeight} ${style.fontSize}px system-ui, sans-serif`;
    ctx.fillStyle = style.color;
    ctx.fillText(text, tx, box.y + box.h * 0.64);
  } else {
    ctx.font = `${style.fontWeight} ${style.fontSize}px system-ui, sans-serif`;
    ctx.fillStyle = text ? style.color : 'rgba(148,163,184,0.5)';
    ctx.fillText(text || 'Text', tx, box.y + box.h / 2);
  }
  ctx.restore();
}

/** 270° sweep with a 90° gap at the bottom -- the classic speedometer shape. */
const GAUGE_START = Math.PI * 0.75;
const GAUGE_END = Math.PI * 2.25;

function drawGauge(ctx: CanvasRenderingContext2D, widget: DashboardWidget, box: Box): void {
  const { style } = widget;
  // Min/Max are entered in whatever unit the widget displays, so the scale
  // reads the way the user configured it (e.g. "0..100 Mbit/s").
  const { value, unit } = displayValue(widget);
  const min = widget.min ?? 0;
  const max = widget.max ?? 100;
  const fraction = max > min ? Math.min(1, Math.max(0, ((value ?? min) - min) / (max - min))) : 0;

  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const radius = Math.max(4, Math.min(box.w, box.h) / 2 - 10);
  const arcWidth = Math.max(4, radius * 0.18);

  // Background/border hug the ring itself -- not the widget's rectangular
  // bounds, and not the whole dial+text together either.
  const hasFrame = style.bgColor || (style.borderColor && style.borderWidth > 0);
  if (hasFrame) {
    const ringR = radius + arcWidth / 2 + 3;
    fillAndStroke(ctx, style, () => {
      ctx.beginPath();
      ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
    });
  }

  ctx.save();
  ctx.globalAlpha = style.opacity;
  ctx.lineCap = 'round';
  ctx.lineWidth = arcWidth;

  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, GAUGE_START, GAUGE_END);
  ctx.stroke();

  if (fraction > 0) {
    ctx.strokeStyle = style.color;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, GAUGE_START, GAUGE_START + (GAUGE_END - GAUGE_START) * fraction);
    ctx.stroke();
  }
  ctx.restore();

  // Value/label text gets its own background/border, sized to just the text.
  const text = formatMetric(value, unit, widget.decimals ?? 0, widget.format);
  const valueY = cy + (widget.label ? -radius * 0.08 : 0);
  const labelY = cy + radius * 0.38;

  ctx.font = `${style.fontWeight} ${style.fontSize}px system-ui, sans-serif`;
  let blockWidth = ctx.measureText(text).width;
  const blockTop = valueY - style.fontSize * 0.65;
  let blockBottom = valueY + style.fontSize * 0.4;
  if (widget.label) {
    ctx.font = `500 ${style.labelFontSize}px system-ui, sans-serif`;
    blockWidth = Math.max(blockWidth, ctx.measureText(widget.label).width);
    blockBottom = labelY + style.labelFontSize * 0.4;
  }
  if (hasFrame) {
    const padX = 14;
    const padY = 8;
    const textBox: Box = {
      x: cx - blockWidth / 2 - padX,
      y: blockTop - padY,
      w: blockWidth + padX * 2,
      h: blockBottom - blockTop + padY * 2,
    };
    fillAndStroke(ctx, style, () => roundRectPath(ctx, textBox, style.borderRadius));
  }

  ctx.save();
  ctx.globalAlpha = style.opacity;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${style.fontWeight} ${style.fontSize}px system-ui, sans-serif`;
  ctx.fillStyle = style.color;
  ctx.fillText(text, cx, valueY);
  if (widget.label) {
    ctx.font = `500 ${style.labelFontSize}px system-ui, sans-serif`;
    ctx.fillStyle = style.labelColor;
    ctx.fillText(widget.label, cx, labelY);
  }
  ctx.restore();
}

/** `#rrggbb` + a two-digit alpha suffix is valid CSS; anything else needs globalAlpha instead. */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Traces a line through `pts` onto the current path -- straight segments, or
 * (when `smooth`) a curve through quadratic Bezier segments anchored at each
 * point's midpoint to its neighbour. Cheap, no external curve library, and
 * passes exactly through every point's midpoints rather than overshooting
 * past the data the way a naive Catmull-Rom fit can.
 */
function tracePolyline(ctx: CanvasRenderingContext2D, pts: [number, number][], smooth: boolean): void {
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (!smooth || pts.length < 3) {
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    return;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const midX = (pts[i][0] + pts[i + 1][0]) / 2;
    const midY = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], midX, midY);
  }
  ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
}

function drawGraph(ctx: CanvasRenderingContext2D, widget: DashboardWidget, box: Box): void {
  drawPanel(ctx, widget, box);
  const { style } = widget;
  const rawPoints = getMetricHistory(widget.metric, widget.historySeconds ?? 60);
  // Same unit as the gauge/text widgets: whatever the widget is set to display.
  const unitOptions = getUnitOptions(widget.metric);
  const factor = unitOptions ? (unitOptions.find((o) => o.key === widget.unit) ?? unitOptions[0]).factor : 1;
  const points = factor === 1 ? rawPoints : rawPoints.map((v) => v * factor);

  // Flush to the widget's true edge when there is no background to pad
  // against; with a background, a small margin keeps the line off the card edge.
  const pad = style.bgColor ? 8 : 0;
  const labelPad = Math.max(pad, 6);

  ctx.save();
  ctx.globalAlpha = style.opacity;
  if (widget.label) {
    ctx.font = `500 ${style.labelFontSize}px system-ui, sans-serif`;
    ctx.fillStyle = style.labelColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(widget.label, box.x + labelPad, box.y + labelPad - 2);
  }

  if (points.length >= 2) {
    const top = widget.label ? box.y + box.h * 0.22 : box.y + pad;
    const innerW = box.w - pad * 2;
    const innerH = box.y + box.h - pad - top;
    const max = widget.max ?? Math.max(...points, 1);
    const min = widget.min ?? Math.min(0, ...points);
    const range = Math.max(1e-6, max - min);

    const at = (i: number): [number, number] => [
      box.x + pad + (i / (points.length - 1)) * innerW,
      top + innerH - ((points[i] - min) / range) * innerH,
    ];
    const pts = points.map((_, i) => at(i));

    ctx.beginPath();
    tracePolyline(ctx, pts, widget.smooth ?? false);
    ctx.strokeStyle = style.color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.beginPath();
    tracePolyline(ctx, pts, widget.smooth ?? false);
    ctx.lineTo(box.x + pad + innerW, top + innerH);
    ctx.lineTo(box.x + pad, top + innerH);
    ctx.closePath();
    ctx.fillStyle = HEX_COLOR.test(style.color) ? `${style.color}26` : style.color;
    if (!HEX_COLOR.test(style.color)) ctx.globalAlpha = style.opacity * 0.15;
    ctx.fill();
    ctx.globalAlpha = style.opacity;
  } else {
    ctx.font = `400 ${Math.max(11, box.h * 0.08)}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(148,163,184,0.5)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('warte auf Daten…', box.x + box.w / 2, box.y + box.h / 2);
  }
  ctx.restore();
}

function drawShape(ctx: CanvasRenderingContext2D, widget: DashboardWidget, box: Box): void {
  const { style } = widget;
  ctx.save();
  ctx.globalAlpha = style.opacity;
  if (widget.shape === 'circle') {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, box.w / 2, box.h / 2, 0, 0, Math.PI * 2);
  } else {
    roundRectPath(ctx, box, style.borderRadius);
  }
  if (style.bgColor) {
    ctx.fillStyle = style.bgColor;
    ctx.fill();
  }
  if (style.borderColor && style.borderWidth > 0) {
    ctx.strokeStyle = style.borderColor;
    ctx.lineWidth = style.borderWidth;
    ctx.stroke();
  }
  ctx.restore();
}

/** Loaded icon images, keyed by path -- redecoding on every draw would be wasteful. */
const iconCache = new Map<string, HTMLImageElement>();

function iconImage(src: string): HTMLImageElement {
  let img = iconCache.get(src);
  if (!img) {
    img = new Image();
    img.src = toMediaUrl(src);
    iconCache.set(src, img);
  }
  return img;
}

function drawIcon(ctx: CanvasRenderingContext2D, widget: DashboardWidget, box: Box): void {
  ctx.save();
  ctx.globalAlpha = widget.style.opacity;
  const img = widget.src ? iconImage(widget.src) : null;

  if (img && img.complete && img.naturalWidth > 0) {
    // contain: fit the whole image inside the box, centred.
    const scale = Math.min(box.w / img.naturalWidth, box.h / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.drawImage(img, box.x + (box.w - dw) / 2, box.y + (box.h - dh) / 2, dw, dh);
  } else {
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.setLineDash([]);
  }
  ctx.restore();
}

export function renderDashboard(ctx: CanvasRenderingContext2D, dashboard: Dashboard, size = 720): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  for (const widget of [...dashboard.widgets].sort((a, b) => a.z - b.z)) {
    const box = boxOf(widget, size);
    switch (widget.type) {
      case 'text':
        drawText(ctx, widget, box);
        break;
      case 'gauge':
        drawGauge(ctx, widget, box);
        break;
      case 'graph':
        drawGraph(ctx, widget, box);
        break;
      case 'shape':
        drawShape(ctx, widget, box);
        break;
      case 'icon':
        drawIcon(ctx, widget, box);
        break;
    }
  }
  ctx.restore();
}
