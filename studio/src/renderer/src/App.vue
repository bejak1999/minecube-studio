<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import type { SourceKind, StreamMode } from '@shared/types';

import logo from '@/assets/logo.png';
import CubeView from '@/components/CubeView.vue';
import PanelCard from '@/components/PanelCard.vue';
import PresetsTab from '@/components/PresetsTab.vue';
import SettingsTab from '@/components/SettingsTab.vue';
import SetupMode from '@/components/SetupMode.vue';
import UnifiedEditor from '@/components/UnifiedEditor.vue';
import { useStudio } from '@/stores/studio';
import { useI18n } from '@/i18n/useI18n';

const studio = useStudio();
const { t } = useI18n();
const ready = ref(false);
const unifiedEditorOpen = ref(false);

const TABS = computed(() => [
  { id: 'panels' as const, labelKey: 'tab.panels' },
  { id: 'presets' as const, labelKey: 'tab.presets' },
  { id: 'settings' as const, labelKey: 'tab.settings' },
]);

onMounted(async () => {
  await studio.init();
  ready.value = true;
});

// -- Ausgabe sliders -----------------------------------------------------
//
// A native <input type="range"> tracks the pointer itself while the user
// drags -- but studio.config only updates once the async patch() IPC round
// trip resolves, so binding :value straight to it re-asserts the last
// *confirmed* position on every unrelated reactive re-render (the pipeline's
// fps/stats counters tick every second), yanking the thumb back mid-drag.
// A local draft absorbs every pointer move instantly; the store only hears
// about it once (on release), and only overwrites the draft when the user
// is not actively holding it -- so a preset/scene load still updates it.
const qualityDraft = ref(studio.config?.quality ?? 0.9);
const maxFpsDraft = ref(studio.config?.maxFps ?? 20);
let qualityDragging = false;
let maxFpsDragging = false;

watch(
  () => studio.config?.quality,
  (v) => {
    if (v !== undefined && !qualityDragging) qualityDraft.value = v;
  },
);
watch(
  () => studio.config?.maxFps,
  (v) => {
    if (v !== undefined && !maxFpsDragging) maxFpsDraft.value = v;
  },
);

function onQualityChange(value: number): void {
  qualityDragging = false;
  void studio.patch({ quality: value });
}
function onMaxFpsChange(value: number): void {
  maxFpsDragging = false;
  void studio.patch({ maxFps: value });
}

/**
 * What each panel's last frame actually encoded at -- can sit well below the
 * slider above for busy content (a noisy camera feed), which is forced down
 * to fit the panel's fixed ~249 KB USB budget regardless of the configured
 * setting. Makes that visible instead of the slider silently seeming to do
 * nothing. Only lists panels that have actually sent a frame.
 */
const actualQualityInfo = computed(() =>
  (studio.config?.slots ?? [])
    .map((slot, i) => ({ label: slot.label, quality: studio.pipeline.stats.actualQuality[i] }))
    .filter((s): s is { label: string; quality: number } => s.quality !== null),
);

const KINDS: { value: SourceKind; labelKey: string }[] = [
  { value: 'none', labelKey: 'source.empty' },
  { value: 'color', labelKey: 'source.color' },
  { value: 'image', labelKey: 'source.image' },
  { value: 'gif', labelKey: 'source.gif' },
  { value: 'video', labelKey: 'source.video' },
  { value: 'stream', labelKey: 'source.stream' },
  { value: 'desktop', labelKey: 'source.desktop' },
];

const servers = computed(() => studio.config?.servers ?? []);
const unifiedCameras = computed(() => {
  const id = studio.config?.unifiedSource.serverId;
  return id ? (studio.cameras[id] ?? []) : [];
});

function fileName(path?: string): string {
  return path ? (path.split(/[\\/]/).pop() ?? path) : '';
}

async function pickUnified(): Promise<void> {
  const file = await window.minecube.pickFile();
  if (!file || !studio.config) return;
  const lower = file.toLowerCase();
  const kind: SourceKind = lower.endsWith('.gif')
    ? 'gif'
    : /\.(mp4|webm|mkv|mov)$/.test(lower)
      ? 'video'
      : 'image';
  await studio.patch({ unifiedSource: { ...studio.config.unifiedSource, kind, src: file } });
}
</script>

<template>
  <div class="flex h-screen flex-col bg-slate-950 text-slate-200">
    <!-- top bar -->
    <header class="flex shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-900/60 px-4 py-2.5">
      <img :src="logo" alt="" class="h-6 w-6 shrink-0" />
      <h1 class="text-sm font-semibold tracking-tight">
        Minecube Studio
        <span class="ml-1.5 font-normal text-slate-500">360 Ultra</span>
      </h1>

      <span
        class="rounded-full px-2 py-0.5 text-[11px]"
        :class="studio.connectedCount === 4 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'"
      >
        {{ studio.connectedCount }}/4 {{ t('studio.connectedCount') }}
      </span>

      <div class="ml-auto flex items-center gap-2">
        <span class="text-[11px] text-slate-500">
          {{ studio.pipeline.stats.fps }} fps · {{ studio.pipeline.stats.encodeMs }} ms {{ t('studio.encodeStats') }}
        </span>
        <button
          class="rounded-md border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800"
          :disabled="studio.busy"
          @click="studio.connectAll()"
        >
          {{ t('studio.reconnect') }}
        </button>
        <button
          class="rounded-md border px-3 py-1.5 text-xs"
          :class="studio.setupMode
            ? 'border-violet-500 bg-violet-600 text-white'
            : 'border-slate-700 hover:bg-slate-800'"
          @click="studio.setupMode = !studio.setupMode"
        >
          {{ t('studio.setup') }}
        </button>
        <button
          class="rounded-md px-3 py-1.5 text-xs font-medium text-white"
          :class="studio.pipeline.isRunning ? 'bg-rose-600 hover:bg-rose-500' : 'bg-emerald-600 hover:bg-emerald-500'"
          @click="studio.togglePlayback()"
        >
          {{ studio.pipeline.isRunning ? t('studio.stop') : t('studio.start') }}
        </button>
      </div>
    </header>

    <p v-if="studio.lastError" class="shrink-0 bg-rose-950/60 px-4 py-2 text-xs text-rose-300">
      {{ studio.lastError }}
    </p>

    <div v-if="!ready" class="grid flex-1 place-items-center text-sm text-slate-500">
      {{ t('studio.searchingPanels') }}
    </div>

    <main v-else class="flex min-h-0 flex-1">
      <!-- cube -->
      <section class="flex min-w-0 flex-1 flex-col border-r border-slate-800">
        <div class="min-h-0 flex-1">
          <CubeView />
        </div>

        <div class="shrink-0 space-y-3 border-t border-slate-800 p-4">
          <div class="flex items-center gap-2">
            <span class="text-xs font-medium text-slate-400">{{ t('studio.mode') }}</span>
            <div class="flex overflow-hidden rounded-md border border-slate-700">
              <button
                v-for="mode in (['individual', 'unified'] as const)"
                :key="mode"
                class="px-3 py-1.5 text-xs"
                :class="studio.config?.layout === mode ? 'bg-violet-600 text-white' : 'hover:bg-slate-800'"
                @click="studio.patch({ layout: mode })"
              >
                {{ mode === 'individual' ? t('studio.individual') : t('studio.unified') }}
              </button>
            </div>

            <template v-if="studio.config?.layout === 'unified'">
              <!-- Kind Selector -->
              <select
                class="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
                :value="studio.config.unifiedSource.kind"
                @change="studio.patch({ unifiedSource: { ...studio.config.unifiedSource, kind: ($event.target as HTMLSelectElement).value as SourceKind } })"
              >
                <option v-for="k in KINDS" :key="k.value" :value="k.value">{{ t(k.labelKey) }}</option>
              </select>

              <!-- File-based picker -->
              <template v-if="['image', 'gif', 'video'].includes(studio.config.unifiedSource.kind)">
                <button
                  class="rounded-md border border-slate-700 px-2.5 py-1.5 text-xs hover:bg-slate-800"
                  @click="pickUnified"
                >
                  {{ t('studio.chooseFile') }}
                </button>
                <span class="truncate text-[11px] text-slate-500 max-w-[150px]">
                  {{ fileName(studio.config.unifiedSource.src) || t('studio.noContent') }}
                </span>
              </template>

              <!-- Color picker -->
              <template v-if="studio.config.unifiedSource.kind === 'color'">
                <input
                  type="color"
                  class="h-7 w-12 rounded border border-slate-700 bg-slate-950"
                  :value="studio.config.unifiedSource.color ?? '#ff0000'"
                  @input="studio.patch({ unifiedSource: { ...studio.config.unifiedSource, color: ($event.target as HTMLInputElement).value } })"
                />
              </template>

              <!-- Stream picker -->
              <template v-if="studio.config.unifiedSource.kind === 'stream'">
                <select
                  class="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
                  :value="studio.config.unifiedSource.serverId ?? ''"
                  @change="studio.patch({ unifiedSource: { ...studio.config.unifiedSource, serverId: ($event.target as HTMLSelectElement).value || undefined, camera: undefined } })"
                >
                  <option value="">{{ t('studio.server') }}</option>
                  <option v-for="s in servers" :key="s.id" :value="s.id">{{ s.name }}</option>
                </select>

                <select
                  class="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
                  :value="studio.config.unifiedSource.camera ?? ''"
                  :disabled="!studio.config.unifiedSource.serverId"
                  @change="studio.patch({ unifiedSource: { ...studio.config.unifiedSource, camera: ($event.target as HTMLSelectElement).value || undefined } })"
                >
                  <option value="">{{ t('studio.camera') }}</option>
                  <option v-for="cam in unifiedCameras" :key="cam.name" :value="cam.name">{{ cam.label }}</option>
                </select>

                <button
                  class="shrink-0 rounded-md border border-slate-700 px-2 py-1.5 text-xs hover:bg-slate-800"
                  :disabled="!studio.config.unifiedSource.serverId"
                  :title="t('studio.reloadCameras')"
                  @click="studio.config.unifiedSource.serverId && studio.loadCameras(studio.config.unifiedSource.serverId)"
                >
                  ↻
                </button>

                <select
                  class="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-300"
                  :value="studio.config.unifiedSource.streamMode ?? 'webrtc'"
                  @change="studio.patch({ unifiedSource: { ...studio.config.unifiedSource, streamMode: ($event.target as HTMLSelectElement).value as StreamMode } })"
                >
                  <option value="webrtc">WebRTC</option>
                  <option value="mjpeg">MJPEG</option>
                </select>
              </template>

              <!-- Desktop picker -->
              <template v-if="studio.config.unifiedSource.kind === 'desktop'">
                <select
                  class="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
                  :value="studio.config.unifiedSource.desktopSourceId ?? ''"
                  @change="studio.patch({ unifiedSource: { ...studio.config.unifiedSource, desktopSourceId: ($event.target as HTMLSelectElement).value || undefined } })"
                >
                  <option value="">{{ t('studio.screen') }}</option>
                  <option v-for="screen in studio.screens" :key="screen.id" :value="screen.id">{{ screen.name }}</option>
                </select>
                <button
                  class="shrink-0 rounded-md border border-slate-700 px-2 py-1.5 text-xs hover:bg-slate-800"
                  :title="t('studio.reloadScreens')"
                  @click="studio.loadScreens()"
                >
                  ↻
                </button>
              </template>

              <div class="ml-auto"></div>

              <button
                v-if="studio.config.unifiedSource.kind !== 'none'"
                class="shrink-0 rounded-md border border-slate-700 px-2.5 py-1.5 text-xs hover:bg-slate-800"
                @click="unifiedEditorOpen = true"
              >
                {{ t('studio.chooseCrop') }}
              </button>
            </template>
          </div>
          
          <p v-if="studio.config?.layout === 'unified' && studio.pipeline.stats.unifiedError" class="text-[11px] text-rose-400">
            {{ studio.pipeline.stats.unifiedError }}
          </p>

          <SetupMode />
        </div>
      </section>

      <!-- side panel -->
      <aside class="flex w-[440px] shrink-0 flex-col p-4 pb-0 relative">
        <!-- Sticky tabs container -->
        <div class="sticky top-0 z-10 bg-slate-950 pb-3">
          <div class="flex overflow-hidden rounded-md border border-slate-700">
            <button
              v-for="tab in TABS"
              :key="tab.id"
              class="flex-1 px-3 py-1.5 text-xs"
              :class="studio.tab === tab.id ? 'bg-violet-600 text-white' : 'hover:bg-slate-800'"
              @click="studio.tab = tab.id"
            >
              {{ t(tab.labelKey) }}
            </button>
          </div>
        </div>

        <div class="flex-1 overflow-y-scroll pb-4">
          <SettingsTab v-if="studio.tab === 'settings'" />
          <PresetsTab v-else-if="studio.tab === 'presets'" />

        <template v-else>
        <div class="grid grid-cols-2 gap-3">
          <PanelCard v-for="(_, index) in studio.slots" :key="index" :index="index" />
        </div>

        <h2 class="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-slate-500">{{ t('studio.output') }}</h2>
        <div class="space-y-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <label class="block">
            <span class="text-xs text-slate-400">
              {{ t('studio.jpegQuality') }} · {{ Math.round(qualityDraft * 100) }}%
            </span>
            <input
              type="range" min="0.1" max="0.98" step="0.02"
              class="mt-1 w-full accent-violet-500"
              :value="qualityDraft"
              @input="qualityDragging = true; qualityDraft = Number(($event.target as HTMLInputElement).value)"
              @change="onQualityChange(Number(($event.target as HTMLInputElement).value))"
            />
            <p v-if="actualQualityInfo.length" class="mt-1 text-[11px] leading-snug text-slate-500">
              {{ t('studio.actualQualityDescription') }}
              <span v-for="(s, i) in actualQualityInfo" :key="s.label">
                <span v-if="i > 0"> · </span>{{ s.label }}: {{ Math.round(s.quality * 100) }}%
              </span>
            </p>
          </label>
          <label class="block">
            <span class="text-xs text-slate-400">{{ t('studio.maxFramerate') }} · {{ maxFpsDraft }} fps</span>
            <input
              type="range" min="1" max="30" step="1"
              class="mt-1 w-full accent-violet-500"
              :value="maxFpsDraft"
              @input="maxFpsDragging = true; maxFpsDraft = Number(($event.target as HTMLInputElement).value)"
              @change="onMaxFpsChange(Number(($event.target as HTMLInputElement).value))"
            />
          </label>
          <label class="flex items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              class="accent-violet-500"
              :checked="studio.config?.playOnStart"
              @change="studio.patch({ playOnStart: ($event.target as HTMLInputElement).checked })"
            />
            {{ t('studio.autoplayOnStart') }}
          </label>
        </div>
        </template>
        </div>
      </aside>
    </main>
    <UnifiedEditor
      v-if="unifiedEditorOpen"
      :source="(studio.pipeline as any).unifiedSource ?? null"
      @close="unifiedEditorOpen = false"
    />
  </div>
</template>
