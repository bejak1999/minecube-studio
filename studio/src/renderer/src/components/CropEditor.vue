<script setup lang="ts">
/**
 * Pick the region of a source that ends up on the panel.
 *
 * The source is shown at its real aspect ratio with a draggable, resizable box
 * over it. The box is square by default -- the panels are square, so a square
 * crop is the one that loses nothing to `cover` -- but it can be freed if you
 * would rather letterbox.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import type { CropRect } from '@shared/types';
import { FULL_CROP } from '@shared/types';

import type { FrameSource } from '@/render/sources/types';
import { useI18n } from '@/i18n/useI18n';

const { t } = useI18n();

const props = defineProps<{
  /** The live source, drawn uncropped so the box can be placed against it. */
  source: FrameSource | null;
  crop: CropRect;
  title: string;
  sourceRotate?: 0 | 90 | 180 | 270;
}>();

const emit = defineEmits<{ update: [CropRect]; close: [] }>();

const stage = ref<HTMLDivElement | null>(null);
const preview = ref<HTMLCanvasElement | null>(null);
const square = ref(true);
let raf = 0;

const aspect = ref(1);

/**
 * Keep painting the full, uncropped source into the backdrop so the box can be
 * positioned against live motion, not a frozen still.
 */
function paint(): void {
  raf = requestAnimationFrame(paint);
  const canvas = preview.value;
  const frame = props.source?.frame;
  const size = props.source?.size;
  if (!canvas || !frame || !size || size.w <= 0) return;

  aspect.value = size.w / size.h;

  const width = 640;
  const height = Math.max(1, Math.round(width / aspect.value));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  try {
    ctx.drawImage(frame, 0, 0, width, height);
  } catch {
    // a video with no decoded frame yet
  }
}

onMounted(() => paint());
onBeforeUnmount(() => cancelAnimationFrame(raf));

const box = computed(() => ({
  left: `${props.crop.x * 100}%`,
  top: `${props.crop.y * 100}%`,
  width: `${props.crop.w * 100}%`,
  height: `${props.crop.h * 100}%`,
}));

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Keep the box square in *source pixels*, not in normalised units. */
function squared(w: number): { w: number; h: number } {
  return square.value ? { w, h: w * aspect.value } : { w, h: props.crop.h };
}

function emitCrop(next: CropRect): void {
  const w = clamp(next.w, 0.05, 1);
  const h = clamp(next.h, 0.05, 1);
  emit('update', {
    x: clamp(next.x, 0, 1 - w),
    y: clamp(next.y, 0, 1 - h),
    w,
    h,
  });
}

type DragMode = 'move' | 'resize';
let mode: DragMode = 'move';
let startPointer = { x: 0, y: 0 };
let startCrop: CropRect = { ...FULL_CROP };

function begin(event: PointerEvent, which: DragMode): void {
  event.preventDefault();
  event.stopPropagation();
  mode = which;
  startPointer = { x: event.clientX, y: event.clientY };
  startCrop = { ...props.crop };
  (event.target as HTMLElement).setPointerCapture(event.pointerId);
}

function move(event: PointerEvent): void {
  if (!event.buttons || !stage.value) return;
  const rect = stage.value.getBoundingClientRect();
  const dx = (event.clientX - startPointer.x) / rect.width;
  const dy = (event.clientY - startPointer.y) / rect.height;

  if (mode === 'move') {
    emitCrop({ ...startCrop, x: startCrop.x + dx, y: startCrop.y + dy });
    return;
  }
  const { w, h } = squared(startCrop.w + dx);
  emitCrop({ x: startCrop.x, y: startCrop.y, w, h });
}

function reset(): void {
  emit('update', { ...FULL_CROP });
}

/** Largest centred square, in normalised units. */
function centerSquare(): void {
  const a = aspect.value;
  const w = a >= 1 ? 1 / a : 1;
  const h = a >= 1 ? 1 : a;
  emit('update', { x: (1 - w) / 2, y: (1 - h) / 2, w, h });
}

function setNumber(field: keyof CropRect, value: string): void {
  const n = Number(value) / 100;
  if (Number.isFinite(n)) emitCrop({ ...props.crop, [field]: n });
}
</script>

<template>
  <div class="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6" @click.self="emit('close')">
    <div class="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
      <header class="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <h2 class="text-sm font-semibold">{{ t('crop.title') }} — {{ title }}</h2>
        <button class="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-800" @click="emit('close')">✕</button>
      </header>

      <div class="min-h-0 flex-1 overflow-auto p-4">
        <!--
          The canvas keeps its own aspect ratio: `width/height: auto` with both
          maximums set is the one combination a replaced element scales without
          distortion. Do NOT put `aspect-ratio` plus `width: 100%` on a wrapper
          -- once max-height bites, the width stays at 100% and the picture is
          stretched. The stage shrink-wraps the canvas, so the overlay's
          percentages are percentages of the picture itself.
        -->
        <div class="flex justify-center">
          <div ref="stage" class="relative inline-block max-w-full select-none rounded-lg bg-black">
            <canvas
              ref="preview"
              class="pointer-events-none block rounded-lg"
              style="width: auto; height: auto; max-width: 100%; max-height: 52vh"
            />
            <div
              v-if="!source?.frame"
              class="absolute inset-0 grid place-items-center px-8 text-center text-xs text-slate-600"
            >
              {{ t('crop.noPreview') }}
            </div>

            <!-- dimmed outside, clear inside -->
            <div
              class="absolute cursor-move rounded border-2 border-violet-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
              :style="box"
              @pointerdown="begin($event, 'move')"
              @pointermove="move"
            >
              <span
                class="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-violet-300 bg-slate-900"
                @pointerdown="begin($event, 'resize')"
                @pointermove="move"
              />
            </div>
          </div>
        </div>

        <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label v-for="f in (['x', 'y', 'w', 'h'] as const)" :key="f" class="block">
            <span class="text-[11px] uppercase tracking-wider text-slate-500">{{ f }} %</span>
            <input
              type="number" min="0" max="100" step="1"
              class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
              :value="Math.round(crop[f] * 100)"
              @change="setNumber(f, ($event.target as HTMLInputElement).value)"
            />
          </label>
        </div>

        <slot name="settings" />
      </div>

      <footer class="flex flex-wrap items-center gap-2 border-t border-slate-800 px-4 py-3">
        <label class="flex items-center gap-1.5 text-xs text-slate-400">
          <input v-model="square" type="checkbox" class="accent-violet-500" />
          {{ t('crop.square') }}
        </label>
        <button class="rounded-md border border-slate-700 px-2.5 py-1 text-xs hover:bg-slate-800" @click="centerSquare">
          {{ t('crop.largestSquare') }}
        </button>
        <button class="rounded-md border border-slate-700 px-2.5 py-1 text-xs hover:bg-slate-800" @click="reset">
          {{ t('crop.fullImage') }}
        </button>
        <button
          class="ml-auto rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500"
          @click="emit('close')"
        >
          {{ t('dashboard.done') }}
        </button>
      </footer>
    </div>
  </div>
</template>
