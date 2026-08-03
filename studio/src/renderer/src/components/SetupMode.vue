<script setup lang="ts">
/**
 * Setup mode: paint a big number straight onto every panel, so you can walk up
 * to the cube, read which physical screen is which, and fix the mapping here.
 */
import { onBeforeUnmount, watch } from 'vue';

import type { Overlay } from '@/render/compositor';
import { useStudio } from '@/stores/studio';
import { useI18n } from '@/i18n/useI18n';

const studio = useStudio();
const { t } = useI18n();

const PALETTE = ['#7c5cff', '#22d3ee', '#f59e0b', '#ef4444'];

function numberOverlay(index: number): Overlay {
  const color = PALETTE[index % PALETTE.length];
  const label = String(index + 1);
  return (ctx, w, h) => {
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = color;
    ctx.lineWidth = 14;
    ctx.strokeRect(24, 24, w - 48, h - 48);

    ctx.fillStyle = color;
    ctx.font = `bold ${Math.round(h * 0.5)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, w / 2, h / 2 - h * 0.03);

    ctx.fillStyle = '#94a3b8';
    ctx.font = `500 ${Math.round(h * 0.06)}px system-ui, sans-serif`;
    ctx.fillText(studio.slots[index]?.label ?? '', w / 2, h * 0.78);

    const panel = studio.slots[index] ? studio.panelFor(studio.slots[index]) : null;
    ctx.fillStyle = '#475569';
    ctx.font = `400 ${Math.round(h * 0.042)}px ui-monospace, monospace`;
    ctx.fillText(panel?.port ?? t('setup.unassigned'), w / 2, h * 0.86);
  };
}

function applyOverlays(active: boolean): void {
  studio.pipeline.slots.forEach((_, index) => {
    studio.pipeline.setOverlay(index, active ? numberOverlay(index) : null, active ? `setup-${index}` : '');
  });
}

watch(() => studio.setupMode, applyOverlays, { immediate: true });
// The overlay prints the slot label, so redraw when labels or bindings change.
watch(
  () => studio.slots.map((s) => `${s.label}:${s.serial}`).join('|'),
  () => studio.setupMode && applyOverlays(true),
);

onBeforeUnmount(() => applyOverlays(false));
</script>

<template>
  <div v-if="studio.setupMode" class="rounded-lg border border-violet-500/40 bg-violet-500/5 p-4">
    <div class="mb-3 flex items-start justify-between gap-4">
      <div>
        <h3 class="text-sm font-semibold text-violet-300">{{ t('setup.active') }}</h3>
        <p class="mt-1 text-xs text-slate-400">
          {{ t('setup.description') }}
        </p>
      </div>
      <button
        class="shrink-0 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500"
        @click="studio.setupMode = false"
      >
        {{ t('dashboard.done') }}
      </button>
    </div>

    <div class="grid grid-cols-2 gap-2">
      <div
        v-for="(slot, index) in studio.slots"
        :key="index"
        class="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900/60 p-2"
      >
        <span
          class="grid h-8 w-8 shrink-0 place-items-center rounded-md text-sm font-bold"
          :style="{ backgroundColor: PALETTE[index % PALETTE.length] + '22', color: PALETTE[index % PALETTE.length] }"
        >
          {{ index + 1 }}
        </span>
        <select
          class="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
          :value="slot.serial ?? ''"
          @change="studio.assign(index, ($event.target as HTMLSelectElement).value || null)"
        >
          <option value="">{{ t('setup.unassigned') }}</option>
          <option v-for="panel in studio.panels" :key="panel.serial" :value="panel.serial">
            {{ panel.port }} · {{ panel.serial.slice(-6) }}
          </option>
        </select>
      </div>
    </div>

    <div class="mt-3 flex flex-wrap gap-2">
      <button
        v-for="pair in [[0, 1], [1, 2], [2, 3], [3, 0]]"
        :key="pair.join('-')"
        class="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
        @click="studio.swap(pair[0], pair[1])"
      >
        {{ pair[0] + 1 }} ⇄ {{ pair[1] + 1 }} {{ t('setup.swap') }}
      </button>
    </div>
  </div>
</template>
