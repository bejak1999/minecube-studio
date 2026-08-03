<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import type { CropRect, CubeFace, SourceKind, StreamMode } from '@shared/types';
import { FULL_CROP, MOUNTED_FACES } from '@shared/types';

import CropEditor from '@/components/CropEditor.vue';
import DashboardEditor from '@/components/dashboard/DashboardEditor.vue';
import PlaylistEditor from '@/components/PlaylistEditor.vue';
import PromptModal from '@/components/PromptModal.vue';
import { kindForFile, useStudio } from '@/stores/studio';
import { useI18n } from '@/i18n/useI18n';

const props = defineProps<{ index: number }>();
const studio = useStudio();
const { t } = useI18n();

const mount = ref<HTMLDivElement | null>(null);
const cropOpen = ref(false);

const slot = computed(() => studio.slots[props.index]);
const panel = computed(() => (slot.value ? studio.panelFor(slot.value) : null));
const runtime = computed(() => studio.pipeline.slots[props.index]);
const status = computed(() => studio.pipeline.status[props.index]);
const crop = computed<CropRect>(() => slot.value?.source.crop ?? FULL_CROP);
const cropped = computed(() => {
  const c = crop.value;
  return c.x !== 0 || c.y !== 0 || c.w !== 1 || c.h !== 1;
});

onMounted(() => {
  const canvas = runtime.value?.canvas.canvas;
  if (!canvas || !mount.value) return;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  mount.value.appendChild(canvas);
});

onBeforeUnmount(() => runtime.value?.canvas.canvas.remove());

const KINDS: { value: SourceKind; labelKey: string }[] = [
  { value: 'none', labelKey: 'source.empty' },
  { value: 'color', labelKey: 'source.color' },
  { value: 'image', labelKey: 'source.image' },
  { value: 'gif', labelKey: 'source.gif' },
  { value: 'video', labelKey: 'source.video' },
  { value: 'stream', labelKey: 'source.stream' },
  { value: 'desktop', labelKey: 'source.desktop' },
];

const editingDashboardId = ref<string | null>(null);

async function newOverlayDashboard(): Promise<void> {
  const id = await studio.addDashboard(`Dashboard ${(studio.config?.dashboards.length ?? 0) + 1}`);
  await studio.updateSlot(props.index, { overlayDashboardId: id });
  editingDashboardId.value = id;
}

const servers = computed(() => studio.config?.servers ?? []);
const camerasForSlot = computed(() => {
  const id = slot.value?.source.serverId;
  return id ? (studio.cameras[id] ?? []) : [];
});

async function pick(): Promise<void> {
  const file = await window.minecube.pickFile();
  if (!file) return;
  await studio.setSlotSource(props.index, {
    kind: kindForFile(file),
    src: file,
    crop: { ...FULL_CROP },
  });
}

const presetSaved = ref(false);
const promptOpen = ref(false);
const presetSuggestion = ref('');

function openPresetPrompt(): void {
  presetSuggestion.value =
    slot.value?.source.camera ??
    slot.value?.source.src?.split(/[\\/]/).pop() ??
    slot.value?.label ??
    'Preset';
  promptOpen.value = true;
}

async function confirmPreset(name: string): Promise<void> {
  promptOpen.value = false;
  await studio.savePreset(props.index, name);
  presetSaved.value = true;
  setTimeout(() => (presetSaved.value = false), 1500);
}

function fileName(path?: string): string {
  return path ? (path.split(/[\\/]/).pop() ?? path) : '';
}

async function setCrop(next: CropRect): Promise<void> {
  await studio.setSlotSource(props.index, { crop: next });
}
</script>

<template>
  <div v-if="slot" class="flex flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-900/60">
    <div class="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
      <div class="flex min-w-0 items-center gap-2">
        <span class="grid h-6 w-6 shrink-0 place-items-center rounded bg-violet-500/15 text-xs font-bold text-violet-300">
          {{ index + 1 }}
        </span>
        <input
          class="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-200 outline-none focus:text-white"
          :value="slot.label"
          @change="studio.updateSlot(index, { label: ($event.target as HTMLInputElement).value })"
        />
      </div>
      <button
        class="shrink-0 px-1 transition-colors"
        :class="presetSaved ? 'text-amber-400' : 'text-slate-500 hover:text-amber-300'"
        :title="t('panel.saveAsPreset')"
        @click="openPresetPrompt"
      >
        {{ presetSaved ? 'X' : 'X' }}
      </button>
      <span
        class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
        :class="panel?.connected ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-700/40 text-slate-400'"
      >
        {{ panel?.connected ? panel.port : t('panel.offline') }}
      </span>
    </div>

    <div ref="mount" class="aspect-square w-full bg-black" />

    <div v-show="studio.config?.layout !== 'unified'" class="space-y-2 p-3">
      <template v-if="!slot.playlist.enabled">
        <div class="flex gap-2">
          <select
            class="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
            :value="slot.source.kind"
            @change="studio.setSlotSource(index, { kind: ($event.target as HTMLSelectElement).value as SourceKind })"
          >
            <option v-for="k in KINDS" :key="k.value" :value="k.value">{{ t(k.labelKey) }}</option>
          </select>
          <button
            v-if="['image', 'gif', 'video'].includes(slot.source.kind)"
            class="shrink-0 rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
            @click="pick"
          >
            {{ t('studio.chooseFile') }}
          </button>
        </div>

        <p v-if="slot.source.src" class="truncate text-[11px] text-slate-500" :title="slot.source.src">
          {{ fileName(slot.source.src) }}
        </p>

        <div v-if="slot.source.kind === 'color'" class="flex items-center gap-2">
          <input
            type="color"
            class="h-7 w-12 rounded border border-slate-700 bg-slate-950"
            :value="slot.source.color ?? '#ff0000'"
            @input="studio.setSlotSource(index, { color: ($event.target as HTMLInputElement).value })"
          />
          <span class="font-mono text-xs text-slate-400">{{ slot.source.color ?? '#ff0000' }}</span>
        </div>

        <template v-if="slot.source.kind === 'stream'">
          <select
            class="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
            :value="slot.source.serverId ?? ''"
            @change="studio.setSlotSource(index, { serverId: ($event.target as HTMLSelectElement).value || undefined, camera: undefined })"
          >
            <option value="">{{ t('panel.selectServer') }}</option>
            <option v-for="s in servers" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>

          <div class="flex gap-2">
            <select
              class="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
              :value="slot.source.camera ?? ''"
              :disabled="!slot.source.serverId"
              @change="studio.setSlotSource(index, { camera: ($event.target as HTMLSelectElement).value || undefined })"
            >
              <option value="">{{ t('panel.selectCamera') }}</option>
              <option v-for="cam in camerasForSlot" :key="cam.name" :value="cam.name">{{ cam.label }}</option>
            </select>
            <button
              class="shrink-0 rounded-md border border-slate-700 px-2 py-1.5 text-xs hover:bg-slate-800"
              :disabled="!slot.source.serverId"
              :title="t('panel.reloadCameras')"
              @click="slot.source.serverId && studio.loadCameras(slot.source.serverId)"
            >
              ↻
            </button>
          </div>

          <select
            class="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-300"
            :value="slot.source.streamMode ?? 'webrtc'"
            @change="studio.setSlotSource(index, { streamMode: ($event.target as HTMLSelectElement).value as StreamMode })"
          >
            <option value="webrtc">{{ t('panel.webrtcLowLatency') }}</option>
            <option value="mjpeg">{{ t('panel.mjpegCompatible') }}</option>
          </select>

          <p v-if="!servers.length" class="text-[11px] text-amber-400">
            {{ t('panel.noServersConfigured') }}
          </p>
        </template>

        <template v-if="slot.source.kind === 'desktop'">
          <div class="flex gap-2">
            <select
              class="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
              :value="slot.source.desktopSourceId ?? ''"
              @change="studio.setSlotSource(index, { desktopSourceId: ($event.target as HTMLSelectElement).value || undefined })"
            >
              <option value="">{{ t('panel.selectScreen') }}</option>
              <option v-for="screen in studio.screens" :key="screen.id" :value="screen.id">{{ screen.name }}</option>
            </select>
            <button
              class="shrink-0 rounded-md border border-slate-700 px-2 py-1.5 text-xs hover:bg-slate-800"
              :title="t('panel.reloadScreens')"
              @click="studio.loadScreens()"
            >
              ↻
            </button>
          </div>
          <p v-if="studio.screenError" class="text-[11px] text-rose-400">
            {{ t('panel.error') }}: {{ studio.screenError }}
          </p>
        </template>

        <div class="flex gap-2">
          <select
            class="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-300"
            :value="slot.source.fit ?? 'cover'"
            @change="studio.setSlotSource(index, { fit: ($event.target as HTMLSelectElement).value as 'cover' })"
          >
            <option value="cover">{{ t('panel.fitCrop') }}</option>
            <option value="contain">{{ t('panel.fitContain') }}</option>
            <option value="stretch">{{ t('panel.fitStretch') }}</option>
          </select>
          <button
            class="shrink-0 rounded-md border px-2.5 py-1.5 text-xs disabled:opacity-40"
            :class="cropped ? 'border-violet-500 text-violet-300' : 'border-slate-700 text-slate-300 hover:bg-slate-800'"
            :disabled="!status?.hasFrame"
            @click="cropOpen = true"
          >
            {{ t('panel.crop') }}{{ cropped ? ' X' : '' }}
          </button>
        </div>

        <div class="flex gap-2">
          <select
            class="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-300"
            :value="slot.viewport.rotate"
            @change="studio.updateSlot(index, { viewport: { ...slot.viewport, rotate: Number(($event.target as HTMLSelectElement).value) as 0 } })"
          >
            <option :value="0">0°</option>
            <option :value="90">90°</option>
            <option :value="180">180°</option>
            <option :value="270">270°</option>
          </select>
          <select
            class="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-300"
            :value="slot.face"
            @change="studio.setFace(index, ($event.target as HTMLSelectElement).value as CubeFace)"
          >
            <option v-for="face in MOUNTED_FACES" :key="face" :value="face">{{ t('panel.crop') }}: {{ face }}</option>
          </select>
        </div>
      </template>

      <div class="space-y-1.5 rounded-md border border-slate-800 bg-slate-950/60 p-2">
        <div class="flex gap-2">
          <select
            class="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
            :value="slot.overlayDashboardId ?? ''"
            @change="studio.updateSlot(index, { overlayDashboardId: ($event.target as HTMLSelectElement).value || null })"
          >
            <option value="">{{ t('panel.noDashboardOverlay') }}</option>
            <option v-for="d in studio.config?.dashboards ?? []" :key="d.id" :value="d.id">{{ d.name }}</option>
          </select>
          <button
            v-if="slot.overlayDashboardId"
            class="shrink-0 rounded-md border border-slate-700 px-2 py-1.5 text-xs hover:bg-slate-800"
            :title="t('panel.editOverlay')"
            @click="editingDashboardId = slot.overlayDashboardId"
          >
            ✎
          </button>
        </div>
        <button
          v-if="!slot.overlayDashboardId"
          class="w-full rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
          @click="newOverlayDashboard"
        >
          {{ t('panel.addOverlay') }}
        </button>
      </div>

      <div class="flex items-center justify-between text-[11px] text-slate-500">
        <span>{{ Math.round((studio.pipeline.stats.lastBytes[index] ?? 0) / 1024) }} KB</span>
        <span v-if="status?.sourceWidth">
          {{ t('panel.source') }} {{ status.sourceWidth }}x{{ status.sourceHeight }}
        </span>
      </div>

      <PlaylistEditor :index="index" />

      <p v-if="status?.error" class="text-[11px] text-rose-400">{{ status.error }}</p>
    </div>

    <CropEditor
      v-if="cropOpen"
      :source="runtime?.source ?? null"
      :crop="crop"
      :title="slot.label"
      @update="setCrop"
      @close="cropOpen = false"
    />

    <PromptModal
      v-if="promptOpen"
      :title="t('panel.presetNamePrompt')"
      :initial-value="presetSuggestion"
      @confirm="confirmPreset"
      @cancel="promptOpen = false"
    />

    <DashboardEditor
      v-if="editingDashboardId"
      :dashboard-id="editingDashboardId"
      @close="editingDashboardId = null"
    />
  </div>
</template>
