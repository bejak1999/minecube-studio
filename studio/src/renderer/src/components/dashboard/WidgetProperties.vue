<script setup lang="ts">
/** Property form for the selected widget. Fields shown depend on its type. */
import { computed } from 'vue';

import { BUILTIN_METRICS, diskMetrics, getUnitOptions } from '@shared/metrics-catalog';
import type { DashboardWidget, MetricDescriptor } from '@shared/types';

import { useStudio } from '@/stores/studio';
import { useI18n } from '@/i18n/useI18n';

const props = defineProps<{ widget: DashboardWidget }>();
const emit = defineEmits<{ update: [Partial<DashboardWidget>]; remove: []; front: []; back: [] }>();
const studio = useStudio();
const { t } = useI18n();

const lhmMetrics = computed<MetricDescriptor[]>(() => studio.hardwareSensors);
const diskMetricList = computed<MetricDescriptor[]>(() => diskMetrics(studio.disks));
const unitOptions = computed(() => getUnitOptions(props.widget.metric));

function translateMetricLabel(label: string): string {
  if (label.includes(':')) {
    const [key, letter] = label.split(':');
    return `${t(key)} ${letter}`;
  }
  return t(label);
}

function setStyle<K extends keyof DashboardWidget['style']>(key: K, value: DashboardWidget['style'][K]): void {
  emit('update', { style: { ...props.widget.style, [key]: value } });
}

/** Picking a border colour should show a border immediately -- width defaulted to 0 otherwise makes the colour picker look broken. */
function setBorderColor(color: string): void {
  const width = props.widget.style.borderWidth > 0 ? props.widget.style.borderWidth : 3;
  emit('update', { style: { ...props.widget.style, borderColor: color, borderWidth: width } });
}

function num(value: string): number {
  return Number(value);
}

async function pickIcon(): Promise<void> {
  const file = await window.minecube.pickFile();
  if (file) emit('update', { src: file });
}
</script>

<template>
  <div class="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-l border-slate-800 p-3 text-xs">
    <div class="flex items-center gap-2">
      <button class="flex-1 rounded border border-slate-700 py-1 hover:bg-slate-800" :title="t('widget.toFront')" @click="emit('front')">
        {{ t('widget.toFront') }}
      </button>
      <button class="flex-1 rounded border border-slate-700 py-1 hover:bg-slate-800" :title="t('widget.toBack')" @click="emit('back')">
        {{ t('widget.toBack') }}
      </button>
      <button class="shrink-0 rounded border border-rose-900 px-2 py-1 text-rose-400 hover:bg-rose-950" :title="t('widget.delete')" @click="emit('remove')">
        ✕
      </button>
    </div>

    <!-- metric binding: text / gauge / graph -->
    <label v-if="['text', 'gauge', 'graph'].includes(widget.type)" class="block">
      <span class="text-[11px] uppercase tracking-wider text-slate-500">{{ t('widget.metric') }}</span>
      <select
        class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5"
        :value="widget.metric ?? ''"
        @change="emit('update', { metric: ($event.target as HTMLSelectElement).value || undefined, unit: undefined })"
      >
        <option value="">{{ widget.type === 'text' ? t('widget.fixedText') : t('widget.none') }}</option>
        <optgroup :label="t('widget.builtIn')">
          <option v-for="m in BUILTIN_METRICS" :key="m.key" :value="m.key">{{ translateMetricLabel(m.label) }}</option>
        </optgroup>
        <optgroup v-if="diskMetricList.length" :label="t('widget.disks')">
          <option v-for="m in diskMetricList" :key="m.key" :value="m.key">{{ translateMetricLabel(m.label) }}</option>
        </optgroup>
        <optgroup v-if="lhmMetrics.length" :label="t('widget.hardware')">
          <option v-for="m in lhmMetrics" :key="m.key" :value="m.key">{{ translateMetricLabel(m.label) }}</option>
        </optgroup>
      </select>
      <p v-if="!lhmMetrics.length" class="mt-1 text-[10px] leading-snug text-slate-600">
        {{ t('widget.hardwareNote') }}
      </p>
    </label>

    <label v-if="unitOptions" class="block">
      <span class="text-[11px] uppercase tracking-wider text-slate-500">{{ t('widget.unit') }}</span>
      <select
        class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5"
        :value="widget.unit ?? unitOptions[0].key"
        @change="emit('update', { unit: ($event.target as HTMLSelectElement).value })"
      >
        <option v-for="o in unitOptions" :key="o.key" :value="o.key">{{ o.label }}</option>
      </select>
    </label>

    <label v-if="widget.type === 'text' && !widget.metric" class="block">
      <span class="text-[11px] uppercase tracking-wider text-slate-500">{{ t('widget.text') }}</span>
      <input
        class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5"
        :value="widget.text ?? ''"
        @change="emit('update', { text: ($event.target as HTMLInputElement).value })"
      />
    </label>

    <label v-if="['text', 'gauge', 'graph'].includes(widget.type)" class="block">
      <span class="text-[11px] uppercase tracking-wider text-slate-500">{{ t('widget.label') }}</span>
      <input
        class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5"
        :placeholder="t('widget.example')"
        :value="widget.label ?? ''"
        @change="emit('update', { label: ($event.target as HTMLInputElement).value || undefined })"
      />
    </label>

    <div v-if="widget.label && ['text', 'gauge', 'graph'].includes(widget.type)" class="flex items-end gap-2">
      <label class="block flex-1">
        <span class="text-[11px] uppercase tracking-wider text-slate-500">{{ t('widget.labelColor') }}</span>
        <input
          type="color"
          class="mt-1 h-8 w-full rounded border border-slate-700 bg-slate-950"
          :value="widget.style.labelColor"
          @input="setStyle('labelColor', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="block flex-1">
        <span class="text-[11px] uppercase tracking-wider text-slate-500">{{ t('widget.labelSize') }} · {{ widget.style.labelFontSize }}</span>
        <input
          type="range" min="10" max="60" step="1"
          class="mt-2 w-full accent-violet-500"
          :value="widget.style.labelFontSize"
          @input="setStyle('labelFontSize', num(($event.target as HTMLInputElement).value))"
        />
      </label>
    </div>

    <div v-if="widget.metric && (widget.type === 'text' || widget.type === 'gauge')" class="flex gap-2">
      <label class="block flex-1">
        <span class="text-[11px] uppercase tracking-wider text-slate-500">{{ t('widget.decimals') }}</span>
        <input
          type="number" min="0" max="3"
          class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5"
          :value="widget.decimals ?? 0"
          @change="emit('update', { decimals: num(($event.target as HTMLInputElement).value) })"
        />
      </label>
      <label class="block flex-1">
        <span class="text-[11px] uppercase tracking-wider text-slate-500">{{ t('widget.format') }}</span>
        <input
          class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5"
          placeholder="{v} {u}"
          :value="widget.format ?? ''"
          @change="emit('update', { format: ($event.target as HTMLInputElement).value || undefined })"
        />
      </label>
    </div>

    <div v-if="widget.type === 'gauge' || widget.type === 'graph'" class="flex gap-2">
      <label class="block flex-1">
        <span class="text-[11px] uppercase tracking-wider text-slate-500">{{ t('widget.min') }}</span>
        <input
          type="number"
          class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5"
          :placeholder="widget.type === 'graph' ? t('widget.auto') : '0'"
          :value="widget.min ?? ''"
          @change="emit('update', { min: ($event.target as HTMLInputElement).value === '' ? undefined : num(($event.target as HTMLInputElement).value) })"
        />
      </label>
      <label class="block flex-1">
        <span class="text-[11px] uppercase tracking-wider text-slate-500">{{ t('widget.max') }}</span>
        <input
          type="number"
          class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5"
          :placeholder="widget.type === 'graph' ? t('widget.auto') : '100'"
          :value="widget.max ?? ''"
          @change="emit('update', { max: ($event.target as HTMLInputElement).value === '' ? undefined : num(($event.target as HTMLInputElement).value) })"
        />
      </label>
    </div>

    <label v-if="widget.type === 'graph'" class="block">
      <span class="text-[11px] uppercase tracking-wider text-slate-500">{{ t('widget.timeRange') }}</span>
      <input
        type="number" min="5" max="120"
        class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5"
        :value="widget.historySeconds ?? 60"
        @change="emit('update', { historySeconds: num(($event.target as HTMLInputElement).value) })"
      />
    </label>

    <label v-if="widget.type === 'graph'" class="flex items-center gap-2">
      <input
        type="checkbox"
        class="accent-violet-500"
        :checked="widget.smooth ?? false"
        @change="emit('update', { smooth: ($event.target as HTMLInputElement).checked })"
      />
      <span class="text-[11px] uppercase tracking-wider text-slate-500">{{ t('widget.smooth') }}</span>
    </label>

    <label v-if="widget.type === 'shape'" class="block">
      <span class="text-[11px] uppercase tracking-wider text-slate-500">{{ t('widget.shape') }}</span>
      <select
        class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5"
        :value="widget.shape ?? 'rect'"
        @change="emit('update', { shape: ($event.target as HTMLSelectElement).value as 'rect' | 'circle' })"
      >
        <option value="rect">{{ t('widget.rectangle') }}</option>
        <option value="circle">{{ t('widget.circle') }}</option>
      </select>
    </label>

    <div v-if="widget.type === 'icon'" class="space-y-1.5">
      <span class="text-[11px] uppercase tracking-wider text-slate-500">{{ t('widget.image') }}</span>
      <p class="truncate text-slate-400" :title="widget.src">{{ widget.src?.split(/[\\/]/).pop() || t('widget.noFile') }}</p>
      <button class="w-full rounded-md border border-slate-700 py-1.5 hover:bg-slate-800" @click="pickIcon">
        {{ t('widget.chooseFile') }}
      </button>
    </div>

    <!-- style -->
    <div v-if="widget.type !== 'icon'" class="space-y-1.5 border-t border-slate-800 pt-3">
      <div class="flex items-center justify-between">
        <span class="text-[11px] uppercase tracking-wider text-slate-500">{{ t('widget.color') }}</span>
        <input
          type="color"
          class="h-6 w-10 rounded border border-slate-700 bg-slate-950"
          :value="widget.style.color"
          @input="setStyle('color', ($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="flex items-center justify-between">
        <span class="text-[11px] uppercase tracking-wider text-slate-500">{{ t('widget.background') }}</span>
        <div class="flex items-center gap-1">
          <input
            type="color"
            class="h-6 w-10 rounded border border-slate-700 bg-slate-950"
            :value="widget.style.bgColor || '#000000'"
            @input="setStyle('bgColor', ($event.target as HTMLInputElement).value)"
          />
          <button class="text-[10px] text-slate-500 hover:text-slate-300" :title="t('widget.transparent')" @click="setStyle('bgColor', '')">✕</button>
        </div>
      </div>
      <label v-if="widget.style.bgColor" class="block">
        <span class="text-[11px] uppercase tracking-wider text-slate-500">
          {{ t('widget.bgOpacity') }} · {{ Math.round((widget.style.bgOpacity ?? 1) * 100) }}%
        </span>
        <input
          type="range" min="0" max="1" step="0.05"
          class="mt-1 w-full accent-violet-500"
          :value="widget.style.bgOpacity ?? 1"
          @input="setStyle('bgOpacity', num(($event.target as HTMLInputElement).value))"
        />
      </label>
      <div class="flex items-center justify-between">
        <span class="text-[11px] uppercase tracking-wider text-slate-500">{{ t('widget.border') }}</span>
        <div class="flex items-center gap-1">
          <input
            type="color"
            class="h-6 w-10 rounded border border-slate-700 bg-slate-950"
            :value="widget.style.borderColor || '#000000'"
            @input="setBorderColor(($event.target as HTMLInputElement).value)"
          />
          <button class="text-[10px] text-slate-500 hover:text-slate-300" :title="t('widget.noBorder')" @click="setStyle('borderColor', '')">✕</button>
        </div>
      </div>
      <label v-if="widget.style.borderColor" class="block">
        <span class="text-[11px] uppercase tracking-wider text-slate-500">{{ t('widget.borderWidth') }} · {{ widget.style.borderWidth }}px</span>
        <input
          type="range" min="1" max="20" step="1"
          class="mt-1 w-full accent-violet-500"
          :value="widget.style.borderWidth"
          @input="setStyle('borderWidth', num(($event.target as HTMLInputElement).value))"
        />
      </label>
    </div>

    <label v-if="['text', 'gauge'].includes(widget.type)" class="block">
      <span class="text-[11px] uppercase tracking-wider text-slate-500">{{ t('widget.fontSize') }} · {{ widget.style.fontSize }}</span>
      <input
        type="range" min="16" max="140" step="2"
        class="mt-1 w-full accent-violet-500"
        :value="widget.style.fontSize"
        @input="setStyle('fontSize', num(($event.target as HTMLInputElement).value))"
      />
    </label>

    <label v-if="widget.type === 'text'" class="block">
      <span class="text-[11px] uppercase tracking-wider text-slate-500">{{ t('widget.align') }}</span>
      <select
        class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5"
        :value="widget.style.align"
        @change="setStyle('align', ($event.target as HTMLSelectElement).value as 'left')"
      >
        <option value="left">{{ t('widget.left') }}</option>
        <option value="center">{{ t('widget.center') }}</option>
        <option value="right">{{ t('widget.right') }}</option>
      </select>
    </label>

    <label class="block">
      <span class="text-[11px] uppercase tracking-wider text-slate-500">{{ t('widget.opacity') }} · {{ Math.round(widget.style.opacity * 100) }}%</span>
      <input
        type="range" min="0.1" max="1" step="0.05"
        class="mt-1 w-full accent-violet-500"
        :value="widget.style.opacity"
        @input="setStyle('opacity', num(($event.target as HTMLInputElement).value))"
      />
    </label>
  </div>
</template>
