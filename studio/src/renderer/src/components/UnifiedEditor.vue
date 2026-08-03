<script setup lang="ts">
/**
 * Pick the region of a unified source that maps to the 4 panels.
 * Displays a cross shape (unfolded cube) overlay.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { useStudio } from '@/stores/studio';
import { useI18n } from '@/i18n/useI18n';
import type { FrameSource } from '@/render/sources/types';

const { t } = useI18n();
const studio = useStudio();

const props = defineProps<{
  source: FrameSource | null;
}>();

const emit = defineEmits<{ close: [] }>();
const stage = ref<HTMLDivElement | null>(null);
const preview = ref<HTMLCanvasElement | null>(null);
let raf = 0;

/** Aspect ratio of the source; 1 while unknown. */
const aspect = computed(() => {
  const s = props.source?.size;
  return s && s.w > 0 && s.h > 0 ? s.w / s.h : 1;
});

function paint(): void {
  raf = requestAnimationFrame(paint);
  const canvas = preview.value;
  const frame = props.source?.frame;
  const size = props.source?.size;
  if (!canvas || !frame || !size || size.w <= 0) return;

  const width = 640;
  const height = Math.max(1, Math.round(width / (size.w / size.h)));
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

const crossX = ref(0);
const crossY = ref(0);
const crossW = ref(1);

onMounted(() => {
  const frontSlot = studio.slots.find(s => s.face === 'front');
  if (frontSlot && frontSlot.viewport.w > 0) {
    const s_w = frontSlot.viewport.w;
    crossW.value = s_w * 3;
    crossX.value = frontSlot.viewport.x - s_w;
    crossY.value = frontSlot.viewport.y - s_w * aspect.value;
  } else {
    centerCross();
  }
});

const crossH = computed(() => (crossW.value / 3) * 2 * aspect.value);

import { watch } from 'vue';
watch(aspect, () => {
  // When the source changes its aspect ratio (e.g. loads for the first time),
  // we must push the updated crossH to the slot viewports to keep them square.
  syncToSlots();
});

const boxStyle = computed(() => ({
  left: `${crossX.value * 100}%`,
  top: `${crossY.value * 100}%`,
  width: `${crossW.value * 100}%`,
  height: `${crossH.value * 100}%`,
}));

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function syncToSlots() {
  const s_w = crossW.value / 3;
  const s_h = crossH.value / 2;

  studio.slots.forEach((slot, index) => {
    const vp = { ...slot.viewport, w: s_w, h: s_h };
    if (slot.face === 'top') {
      vp.x = crossX.value + s_w;
      vp.y = crossY.value;
    } else if (slot.face === 'left') {
      vp.x = crossX.value;
      vp.y = crossY.value + s_h;
    } else if (slot.face === 'front') {
      vp.x = crossX.value + s_w;
      vp.y = crossY.value + s_h;
    } else if (slot.face === 'right') {
      vp.x = crossX.value + 2 * s_w;
      vp.y = crossY.value + s_h;
    } else {
      vp.x = crossX.value + s_w;
      vp.y = crossY.value + s_h;
    }
    studio.updateSlot(index, { viewport: vp });
  });
}

function updateCross(x: number, y: number, w: number) {
  // The cross aspect ratio is 1.5 (3 wide, 2 high).
  // If the video is very wide (e.g. 16:9 = 1.77), a cross spanning the full width
  // would be taller than the video (1.18). We must restrict the max width so
  // height never exceeds 1.0.
  const maxW = Math.min(1.0, 1.5 / aspect.value);
  const nextW = clamp(w, 0.1, maxW);
  const nextH = (nextW / 3) * 2 * aspect.value;
  const nextX = clamp(x, 0, 1 - nextW);
  const nextY = clamp(y, 0, 1 - nextH);
  
  crossX.value = nextX;
  crossY.value = nextY;
  crossW.value = nextW;
  
  syncToSlots();
}

type DragMode = 'move' | 'resize';
let mode: DragMode = 'move';
let startPointer = { x: 0, y: 0 };
let startCross = { x: 0, y: 0, w: 1 };

function begin(event: PointerEvent, which: DragMode): void {
  event.preventDefault();
  event.stopPropagation();
  mode = which;
  startPointer = { x: event.clientX, y: event.clientY };
  startCross = { x: crossX.value, y: crossY.value, w: crossW.value };
  (event.target as HTMLElement).setPointerCapture(event.pointerId);
}

function move(event: PointerEvent): void {
  if (!event.buttons || !stage.value) return;
  const rect = stage.value.getBoundingClientRect();
  const dx = (event.clientX - startPointer.x) / rect.width;
  const dy = (event.clientY - startPointer.y) / rect.height;

  if (mode === 'move') {
    updateCross(startCross.x + dx, startCross.y + dy, startCross.w);
    return;
  }
  updateCross(startCross.x, startCross.y, startCross.w + dx);
}

function centerCross(): void {
  const maxW = 1.0;
  const maxH = 1.0;
  let w = maxW;
  let h = (w / 3) * 2 * aspect.value;
  if (h > maxH) {
    h = maxH;
    w = (h / aspect.value / 2) * 3;
  }
  updateCross((1 - w) / 2, (1 - h) / 2, w);
}

</script>

<template>
  <div class="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6" @click.self="emit('close')">
    <div class="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
      <header class="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <h2 class="text-sm font-semibold">{{ t('unified.title') }} — {{ t('unified.selectCrop') }}</h2>
        <button class="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-800" @click="emit('close')">✕</button>
      </header>

      <div class="min-h-0 flex-1 overflow-auto p-4">
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
              keine Vorschau
            </div>

            <div
              class="absolute cursor-move shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
              :style="boxStyle"
              @pointerdown="begin($event, 'move')"
              @pointermove="move"
            >
              <!-- Cross layout visualization -->
              <div class="absolute w-full h-full pointer-events-none grid grid-cols-3 grid-rows-2">
                <!-- Row 1 -->
                <div class="border border-transparent"></div>
                <div class="border-2 border-violet-400 bg-violet-500/10 flex items-center justify-center text-violet-300 font-bold text-xl"><span class="bg-black/50 px-2 py-1 rounded">Top</span></div>
                <div class="border border-transparent"></div>
                
                <!-- Row 2 -->
                <div class="border-2 border-violet-400 bg-violet-500/10 flex items-center justify-center text-violet-300 font-bold text-xl"><span class="bg-black/50 px-2 py-1 rounded">Left</span></div>
                <div class="border-2 border-violet-400 bg-violet-500/10 flex items-center justify-center text-violet-300 font-bold text-xl"><span class="bg-black/50 px-2 py-1 rounded">Front</span></div>
                <div class="border-2 border-violet-400 bg-violet-500/10 flex items-center justify-center text-violet-300 font-bold text-xl"><span class="bg-black/50 px-2 py-1 rounded">Right</span></div>
              </div>

              <span
                class="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-violet-300 bg-slate-900 pointer-events-auto z-10"
                @pointerdown.stop="begin($event, 'resize')"
                @pointermove="move"
              />
            </div>
          </div>
        </div>
      </div>

      <footer class="flex flex-wrap items-center gap-2 border-t border-slate-800 px-4 py-3">
        <button class="rounded-md border border-slate-700 px-2.5 py-1 text-xs hover:bg-slate-800" @click="centerCross">
          Ansicht zentrieren
        </button>
        <button
          class="ml-auto rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500"
          @click="emit('close')"
        >
          Fertig
        </button>
      </footer>
    </div>
  </div>
</template>
