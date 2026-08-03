<script setup lang="ts">
import type { WidgetType } from '@shared/types';
import { useI18n } from '@/i18n/useI18n';

const { t } = useI18n();

defineEmits<{ add: [WidgetType] }>();

const ITEMS: { type: WidgetType; labelKey: string; hintKey: string; icon: string }[] = [
  { type: 'text', labelKey: 'widget.text.label', hintKey: 'widget.text.hint', icon: 'A' },
  { type: 'gauge', labelKey: 'widget.gauge.label', hintKey: 'widget.gauge.hint', icon: 'O' },
  { type: 'graph', labelKey: 'widget.graph.label', hintKey: 'widget.graph.hint', icon: '~' },
  { type: 'shape', labelKey: 'widget.shape.label', hintKey: 'widget.shape.hint', icon: '[]' },
  { type: 'icon', labelKey: 'widget.icon.label', hintKey: 'widget.icon.hint', icon: '*' },
];
</script>

<template>
  <div class="flex shrink-0 flex-col gap-1.5 border-r border-slate-800 p-2">
    <button
      v-for="item in ITEMS"
      :key="item.type"
      class="flex w-24 flex-col items-center gap-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-3 text-center hover:border-violet-500 hover:bg-slate-800"
      :title="t(item.hintKey)"
      @click="$emit('add', item.type)"
    >
      <span class="text-xl text-violet-300">{{ item.icon }}</span>
      <span class="text-[11px] leading-tight text-slate-300">{{ t(item.labelKey) }}</span>
    </button>
  </div>
</template>
