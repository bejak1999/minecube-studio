<script setup lang="ts">
/**
 * Full-screen dashboard designer: palette, a draggable/resizable canvas, and a
 * properties panel -- the same three-pane shape as EspHomeTool_V1's LVGL
 * editor, scoped to the four widget types this app needs.
 *
 * Widgets are added by clicking a palette entry (not dragged onto the canvas):
 * it appends the widget at a cascading default position, already selected, so
 * the very next action is placing it with the mouse. That keeps the pointer
 * math to "drag to move, handle to resize" -- the same interaction CropEditor
 * already uses -- instead of also handling native HTML5 drag-and-drop.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { defaultWidgetStyle } from '@shared/types';
import type { Dashboard, DashboardWidget, WidgetType } from '@shared/types';

import { renderDashboard } from '@/render/dashboard/render';
import { ensureMetricsStore, subscribeMetrics } from '@/render/metrics-store';
import { useStudio } from '@/stores/studio';
import { useI18n } from '@/i18n/useI18n';

import WidgetPalette from './WidgetPalette.vue';
import WidgetProperties from './WidgetProperties.vue';

const props = defineProps<{ dashboardId: string }>();
const emit = defineEmits<{ close: [] }>();
const studio = useStudio();
const { t } = useI18n();

const source = studio.config?.dashboards.find((d) => d.id === props.dashboardId);
if (!source) throw new Error(`Dashboard ${props.dashboardId} nicht gefunden`);
// A local, plain-object working copy: dragging must feel instant, and writing
// to the store (IPC round trip + disk write) on every pointermove would not.
const draft = ref<Dashboard>(JSON.parse(JSON.stringify(source)));

const stage = ref<HTMLDivElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const selectedId = ref<string | null>(null);
const selected = computed(() => draft.value.widgets.find((w) => w.id === selectedId.value) ?? null);

// Redraw on demand rather than every animation frame: with nothing to change
// between metrics ticks (~1/s), 60-240 unconditional canvas repaints a second
// (screen-refresh-rate dependent) would be pure waste. A drag still needs the
// display's full rate for smooth feedback, so it gets its own short-lived rAF
// loop for as long as the pointer is down; everything else is event-driven.
let raf = 0;
let dirty = true;

function paint(): void {
  if (!dirty) return;
  dirty = false;
  const ctx = canvas.value?.getContext('2d');
  if (!ctx) return;
  // renderDashboard never clears -- it is designed to draw over a panel's
  // existing content when used as the real overlay. The editor preview has
  // no such content underneath, so it owns clearing the canvas each frame.
  ctx.clearRect(0, 0, 720, 720);
  renderDashboard(ctx, draft.value);
}

function requestPaint(): void {
  dirty = true;
  if (!raf) raf = requestAnimationFrame(() => {
    raf = 0;
    paint();
  });
}

let unsubscribeMetrics: (() => void) | null = null;

onMounted(() => {
  ensureMetricsStore();
  if (canvas.value) {
    canvas.value.width = 720;
    canvas.value.height = 720;
  }
  requestPaint();
  unsubscribeMetrics = subscribeMetrics(requestPaint);
  if (!studio.hardwareSensors.length) void studio.loadHardwareSensors();
  if (!studio.disks.length) void studio.loadDisks();
});
onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  unsubscribeMetrics?.();
});

function newId(): string {
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

const DEFAULT_SIZE: Record<WidgetType, { w: number; h: number }> = {
  text: { w: 0.32, h: 0.16 },
  gauge: { w: 0.34, h: 0.34 },
  graph: { w: 0.44, h: 0.22 },
  shape: { w: 0.22, h: 0.22 },
  icon: { w: 0.2, h: 0.2 },
};

function addWidget(type: WidgetType): void {
  const size = DEFAULT_SIZE[type];
  // Cascade successive adds so they do not land exactly on top of each other.
  const offset = (draft.value.widgets.length % 6) * 0.03;
  const maxZ = draft.value.widgets.reduce((m, w) => Math.max(m, w.z), -1);
  const widget: DashboardWidget = {
    id: newId(),
    type,
    x: 0.1 + offset,
    y: 0.1 + offset,
    w: size.w,
    h: size.h,
    z: maxZ + 1,
    style: defaultWidgetStyle(),
    ...(type === 'text' ? { text: 'Text' } : {}),
    ...(type === 'shape' ? { shape: 'rect' as const, style: { ...defaultWidgetStyle(), bgColor: '#7c5cff' } } : {}),
  };
  draft.value.widgets.push(widget);
  selectedId.value = widget.id;
  void save();
}

function updateSelected(patch: Partial<DashboardWidget>): void {
  const widget = selected.value;
  if (!widget) return;
  Object.assign(widget, patch);
  void save();
}

function removeSelected(): void {
  if (!selectedId.value) return;
  draft.value.widgets = draft.value.widgets.filter((w) => w.id !== selectedId.value);
  selectedId.value = null;
  void save();
}

function bringToFront(): void {
  const widget = selected.value;
  if (!widget) return;
  const maxZ = draft.value.widgets.reduce((m, w) => Math.max(m, w.z), -1);
  widget.z = maxZ + 1;
  void save();
}

function sendToBack(): void {
  const widget = selected.value;
  if (!widget) return;
  const minZ = draft.value.widgets.reduce((m, w) => Math.min(m, w.z), 0);
  widget.z = minZ - 1;
  void save();
}

let saveTimer = 0;
async function save(): Promise<void> {
  // Every mutation funnels through here, so this is also the one place that
  // needs to request a repaint -- covers the palette, properties panel,
  // z-order buttons and the rename field in one spot.
  requestPaint();
  // Coalesce bursts (a drag fires many updates) into one write shortly after
  // the last change, rather than one disk write per pointermove.
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void studio.updateDashboard(JSON.parse(JSON.stringify(draft.value)) as Dashboard);
  }, 150);
}

function renameDashboard(name: string): void {
  draft.value.name = name;
  void save();
}

// -- drag / resize -----------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Alignment guides other widgets offer on one axis: their start, centre and end -- plus the canvas edges/centre. */
function guides(axis: 'x' | 'y', excludeId: string): number[] {
  const values = [0, 0.5, 1];
  for (const w of draft.value.widgets) {
    if (w.id === excludeId) continue;
    const pos = axis === 'x' ? w.x : w.y;
    const size = axis === 'x' ? w.w : w.h;
    values.push(pos, pos + size / 2, pos + size);
  }
  return values;
}

const SNAP_PX = 8;
const CANVAS_PX = 720;
const SNAP_THRESHOLD = SNAP_PX / CANVAS_PX;

/** The guide line(s) currently highlighted, in fractional canvas coordinates -- only non-empty mid-drag. */
const activeSnapX = ref<number[]>([]);
const activeSnapY = ref<number[]>([]);

/** Snaps whichever of a box's start/centre/end edge on this axis is closest to a guide, within a small pixel threshold. */
function snapMove(pos: number, size: number, candidates: number[]): { value: number; hit: number | null } {
  let bestDelta = 0;
  let bestDist = SNAP_THRESHOLD;
  let hit: number | null = null;
  for (const g of candidates) {
    for (const point of [pos, pos + size / 2, pos + size]) {
      const dist = Math.abs(g - point);
      if (dist < bestDist) {
        bestDist = dist;
        bestDelta = g - point;
        hit = g;
      }
    }
  }
  return { value: pos + bestDelta, hit };
}

/** Snaps a single edge (the far side while resizing) to the nearest guide. */
function snapEdge(edge: number, candidates: number[]): { value: number; hit: number | null } {
  let best = edge;
  let bestDist = SNAP_THRESHOLD;
  let hit: number | null = null;
  for (const g of candidates) {
    const dist = Math.abs(g - edge);
    if (dist < bestDist) {
      bestDist = dist;
      best = g;
      hit = g;
    }
  }
  return { value: best, hit };
}

type DragMode = 'move' | 'resize';
let dragId: string | null = null;
let dragMode: DragMode = 'move';
let startPointer = { x: 0, y: 0 };
let startBox = { x: 0, y: 0, w: 0, h: 0 };

function beginDrag(event: PointerEvent, widget: DashboardWidget, mode: DragMode): void {
  event.preventDefault();
  event.stopPropagation();
  selectedId.value = widget.id;
  dragId = widget.id;
  dragMode = mode;
  startPointer = { x: event.clientX, y: event.clientY };
  startBox = { x: widget.x, y: widget.y, w: widget.w, h: widget.h };
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function onDrag(event: PointerEvent): void {
  if (!dragId || !event.buttons || !stage.value) return;
  const widget = draft.value.widgets.find((w) => w.id === dragId);
  if (!widget) return;
  const rect = stage.value.getBoundingClientRect();
  const dx = (event.clientX - startPointer.x) / rect.width;
  const dy = (event.clientY - startPointer.y) / rect.height;
  const snap = !event.shiftKey;

  if (dragMode === 'move') {
    let x = clamp(startBox.x + dx, 0, 1 - startBox.w);
    let y = clamp(startBox.y + dy, 0, 1 - startBox.h);
    if (snap) {
      const sx = snapMove(x, startBox.w, guides('x', widget.id));
      const sy = snapMove(y, startBox.h, guides('y', widget.id));
      x = clamp(sx.value, 0, 1 - startBox.w);
      y = clamp(sy.value, 0, 1 - startBox.h);
      activeSnapX.value = sx.hit !== null ? [sx.hit] : [];
      activeSnapY.value = sy.hit !== null ? [sy.hit] : [];
    } else {
      activeSnapX.value = [];
      activeSnapY.value = [];
    }
    widget.x = x;
    widget.y = y;
  } else {
    let w = clamp(startBox.w + dx, 0.03, 1 - startBox.x);
    let h = clamp(startBox.h + dy, 0.03, 1 - startBox.y);
    if (snap) {
      const sx = snapEdge(widget.x + w, guides('x', widget.id));
      const sy = snapEdge(widget.y + h, guides('y', widget.id));
      w = clamp(sx.value - widget.x, 0.03, 1 - startBox.x);
      h = clamp(sy.value - widget.y, 0.03, 1 - startBox.y);
      activeSnapX.value = sx.hit !== null ? [sx.hit] : [];
      activeSnapY.value = sy.hit !== null ? [sy.hit] : [];
    } else {
      activeSnapX.value = [];
      activeSnapY.value = [];
    }
    widget.w = w;
    widget.h = h;
  }
  // Live feedback every pointermove; the persisted save() stays debounced in
  // endDrag()/save() so dragging does not also mean one disk write per pixel.
  requestPaint();
}

function endDrag(): void {
  if (dragId) void save();
  dragId = null;
  activeSnapX.value = [];
  activeSnapY.value = [];
}

function boxStyle(widget: DashboardWidget): Record<string, string> {
  return {
    left: `${widget.x * 100}%`,
    top: `${widget.y * 100}%`,
    width: `${widget.w * 100}%`,
    height: `${widget.h * 100}%`,
  };
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex flex-col bg-slate-950">
    <header class="flex shrink-0 items-center gap-3 border-b border-slate-800 px-4 py-2.5">
      <input
        class="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm font-medium text-slate-200 outline-none focus:border-violet-500"
        :value="draft.name"
        @change="renameDashboard(($event.target as HTMLInputElement).value)"
      />
      <span class="text-[11px] text-slate-600">
        {{ t('dashboard.autoSaved') }}
      </span>
      <button
        class="ml-auto rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500"
        @click="emit('close')"
      >
        {{ t('dashboard.done') }}
      </button>
    </header>

    <div class="flex min-h-0 flex-1">
      <WidgetPalette @add="addWidget" />

      <div class="flex flex-1 items-center justify-center overflow-auto p-6" @pointerdown="selectedId = null">
        <!--
          Same wrapper as CropEditor: the canvas keeps its own aspect ratio via
          width/height:auto with both maxima set. A wrapper with aspect-ratio +
          width:100% + max-height distorts once the height clamp kicks in.
        -->
        <div
          ref="stage"
          class="relative inline-block select-none rounded-lg shadow-2xl"
          style="background-image: repeating-conic-gradient(#1e293b 0% 25%, #0f172a 0% 50%); background-size: 24px 24px"
          @pointerdown.stop
        >
          <canvas ref="canvas" class="block rounded-lg" style="width: 70vh; height: 70vh; max-width: 70vw; max-height: 70vh" />

          <div
            v-for="gx in activeSnapX"
            :key="`gx-${gx}`"
            class="pointer-events-none absolute inset-y-0 w-px bg-pink-400"
            :style="{ left: `${gx * 100}%` }"
          />
          <div
            v-for="gy in activeSnapY"
            :key="`gy-${gy}`"
            class="pointer-events-none absolute inset-x-0 h-px bg-pink-400"
            :style="{ top: `${gy * 100}%` }"
          />

          <div
            v-for="widget in draft.widgets"
            :key="widget.id"
            class="absolute cursor-move"
            :class="widget.id === selectedId ? 'outline outline-2 outline-violet-400' : ''"
            :style="boxStyle(widget)"
            @pointerdown="beginDrag($event, widget, 'move')"
            @pointermove="onDrag"
            @pointerup="endDrag"
          >
            <span
              v-if="widget.id === selectedId"
              class="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-violet-300 bg-slate-900"
              @pointerdown="beginDrag($event, widget, 'resize')"
              @pointermove="onDrag"
              @pointerup="endDrag"
            />
          </div>
        </div>
      </div>

      <WidgetProperties
        v-if="selected"
        :widget="selected"
        @update="updateSelected"
        @remove="removeSelected"
        @front="bringToFront"
        @back="sendToBack"
      />
      <div v-else class="w-64 shrink-0 border-l border-slate-800 p-4 text-xs text-slate-500">
        {{ t('dashboard.selectWidget') }}
      </div>
    </div>
  </div>
</template>
