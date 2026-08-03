<script setup lang="ts">
import { ref } from 'vue';

import type { SourcePreset } from '@shared/types';
import { useStudio } from '@/stores/studio';
import { useI18n } from '@/i18n/useI18n';
import DashboardEditor from '@/components/dashboard/DashboardEditor.vue';

const studio = useStudio();
const { t } = useI18n();
const sceneName = ref('');
const editingDashboardId = ref<string | null>(null);

async function newDashboard(): Promise<void> {
  editingDashboardId.value = await studio.addDashboard(
    `Dashboard ${(studio.config?.dashboards.length ?? 0) + 1}`,
  );
}

function describe(preset: SourcePreset): string {
  if (preset.playlist?.enabled) {
    return `${t('presets.carousel')} · ${preset.playlist.items.length} ${t('presets.elements')}`;
  }
  const { kind, src, camera, color } = preset.source;
  if (kind === 'stream') return `${t('presets.stream')} · ${camera ?? '—'}`;
  if (kind === 'color') return `${t('presets.color')} · ${color ?? '—'}`;
  if (src) return src.split(/[\\/]/).pop() ?? src;
  return kind;
}

async function saveScene(): Promise<void> {
  const name = sceneName.value.trim() || `Scene ${(studio.config?.scenes.length ?? 0) + 1}`;
  await studio.saveScene(name);
  sceneName.value = '';
}
</script>

<template>
  <div class="space-y-5">
    <!-- panel presets -->
    <section>
      <h2 class="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{{ t('presets.title') }}</h2>
      <p class="mb-2 text-xs text-slate-500">
        {{ t('presets.description') }}
      </p>

      <p
        v-if="!studio.config?.presets.length"
        class="rounded-lg border border-dashed border-slate-700 p-4 text-center text-xs text-slate-500"
      >
        {{ t('presets.noPresets') }}
      </p>

      <div
        v-for="preset in studio.config?.presets ?? []"
        :key="preset.id"
        class="mb-2 space-y-2 rounded-lg border border-slate-800 bg-slate-900/60 p-2.5"
      >
        <div class="flex items-center gap-2">
          <input
            class="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-200 outline-none focus:text-white"
            :value="preset.name"
            @change="studio.renamePreset(preset.id, ($event.target as HTMLInputElement).value)"
          />
          <button
            class="shrink-0 px-1 text-slate-600 hover:text-rose-400"
            :title="t('presets.deleteTitle')"
            @click="studio.removePreset(preset.id)"
          >
            ✕
          </button>
        </div>
        <p class="truncate text-[11px] text-slate-500">
          {{ describe(preset) }}
        </p>
        <div class="flex flex-wrap gap-1">
          <span class="mr-1 text-[11px] text-slate-500">{{ t('presets.showOn') }}</span>
          <button
            v-for="(slot, index) in studio.slots"
            :key="index"
            class="rounded border border-slate-700 px-1.5 py-0.5 text-[11px] hover:bg-violet-600 hover:text-white"
            :title="slot.label"
            @click="studio.applyPreset(preset.id, index)"
          >
            {{ index + 1 }}
          </button>
        </div>
      </div>
    </section>

    <!-- dashboards -->
    <section>
      <div class="mb-1 flex items-center justify-between">
        <h2 class="text-xs font-semibold uppercase tracking-wider text-slate-500">{{ t('presets.dashboards') }}</h2>
        <button
          class="rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-violet-500"
          @click="newDashboard"
        >
          {{ t('presets.addNew') }}
        </button>
      </div>
      <p class="mb-2 text-xs text-slate-500">
        {{ t('presets.dashboardsDescription') }}
      </p>

      <p
        v-if="!studio.config?.dashboards.length"
        class="rounded-lg border border-dashed border-slate-700 p-4 text-center text-xs text-slate-500"
      >
        {{ t('presets.noDashboards') }}
      </p>

      <div
        v-for="dash in studio.config?.dashboards ?? []"
        :key="dash.id"
        class="mb-2 space-y-2 rounded-lg border border-slate-800 bg-slate-900/60 p-2.5"
      >
        <div class="flex items-center gap-2">
          <span class="min-w-0 flex-1 truncate text-sm font-medium text-slate-200">{{ dash.name }}</span>
          <span class="shrink-0 text-[11px] text-slate-500">{{ dash.widgets.length }} {{ t('presets.widgets') }}</span>
          <button
            class="shrink-0 rounded border border-slate-700 px-2 py-0.5 text-[11px] hover:bg-slate-800"
            @click="editingDashboardId = dash.id"
          >
            {{ t('presets.edit') }}
          </button>
          <button
            class="shrink-0 px-1 text-slate-600 hover:text-rose-400"
            :title="t('presets.deleteDashboard')"
            @click="studio.removeDashboard(dash.id)"
          >
            ✕
          </button>
        </div>
        <div class="flex flex-wrap gap-1">
          <span class="mr-1 text-[11px] text-slate-500">{{ t('presets.overlayOn') }}</span>
          <button
            v-for="(slot, index) in studio.slots"
            :key="index"
            class="rounded border px-1.5 py-0.5 text-[11px] hover:bg-violet-600 hover:text-white"
            :class="slot.overlayDashboardId === dash.id ? 'border-violet-500 text-violet-300' : 'border-slate-700'"
            :title="slot.label"
            @click="studio.updateSlot(index, { overlayDashboardId: slot.overlayDashboardId === dash.id ? null : dash.id })"
          >
            {{ index + 1 }}
          </button>
        </div>
      </div>
    </section>

    <!-- scenes -->
    <section>
      <h2 class="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{{ t('presets.scenes') }}</h2>
      <p class="mb-2 text-xs text-slate-500">
        {{ t('presets.scenesDescription') }}
      </p>

      <div class="mb-2 flex gap-2">
        <input
          v-model="sceneName"
          class="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
          :placeholder="t('presets.sceneName')"
          @keyup.enter="saveScene"
        />
        <button
          class="shrink-0 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500"
          @click="saveScene"
        >
          {{ t('presets.saveCurrent') }}
        </button>
      </div>

      <p
        v-if="!studio.config?.scenes.length"
        class="rounded-lg border border-dashed border-slate-700 p-4 text-center text-xs text-slate-500"
      >
        {{ t('presets.noScenes') }}
      </p>

      <div
        v-for="scene in studio.config?.scenes ?? []"
        :key="scene.id"
        class="mb-2 flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-2.5"
      >
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-slate-200">{{ scene.name }}</p>
          <p class="truncate text-[11px] text-slate-500">
            {{ scene.layout === 'unified' ? t('studio.unified') : t('studio.individual') }} ·
            {{ scene.slots.filter((s) => s.playlist.enabled).length }} {{ t('presets.carousel') }}(s)
          </p>
        </div>
        <button
          class="shrink-0 rounded-md border border-slate-700 px-2.5 py-1 text-xs hover:bg-slate-800"
          @click="studio.applyScene(scene.id)"
        >
          {{ t('presets.load') }}
        </button>
        <button
          class="shrink-0 px-1 text-slate-600 hover:text-rose-400"
          :title="t('presets.deleteScene')"
          @click="studio.removeScene(scene.id)"
        >
          ✕
        </button>
      </div>
    </section>

    <DashboardEditor
      v-if="editingDashboardId"
      :dashboard-id="editingDashboardId"
      @close="editingDashboardId = null"
    />
  </div>
</template>
