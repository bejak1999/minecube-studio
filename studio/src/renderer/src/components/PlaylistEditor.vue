<script setup lang="ts">
import { computed, nextTick, ref, shallowRef } from 'vue';

import type { CropRect, PlaylistItem, SourceKind, SourceConfig } from '@shared/types';
import { emptyPlaylist, FULL_CROP } from '@shared/types';

import CropEditor from '@/components/CropEditor.vue';
import { createSource, type FrameSource } from '@/render/sources/types';
import { kindForFile, useStudio } from '@/stores/studio';
import { useI18n } from '@/i18n/useI18n';

const props = defineProps<{ index: number }>();
const studio = useStudio();
const { t } = useI18n();

const playlist = computed(() => studio.slots[props.index]?.playlist ?? emptyPlaylist());
const currentItemId = computed(() => studio.pipeline.status[props.index]?.currentItemId ?? null);

function fileName(path?: string): string {
  return path ? (path.split(/[\\/]/).pop() ?? path) : t('playlist.noFile');
}

function itemLabel(item: PlaylistItem): string {
  if (item.source.src) return fileName(item.source.src);
  if (item.source.camera) return item.source.camera;
  if (item.source.kind === 'color') return item.source.color ?? t('presets.color');
  return item.source.kind;
}

const editingItemId = ref<string | null>(null);
const editingCrop = ref<CropRect>({ ...FULL_CROP });
const tempSource = shallowRef<FrameSource | null>(null);

const editingItem = computed(() => playlist.value.items.find(i => i.id === editingItemId.value));
const servers = computed(() => studio.config?.servers ?? []);
const camerasForEditing = computed(() => {
  const id = editingItem.value?.source.serverId;
  return id ? (studio.cameras[id] ?? []) : [];
});

const KINDS: { value: SourceKind; labelKey: string }[] = [
  { value: 'none', labelKey: 'source.empty' },
  { value: 'color', labelKey: 'source.color' },
  { value: 'image', labelKey: 'source.image' },
  { value: 'gif', labelKey: 'source.gif' },
  { value: 'video', labelKey: 'source.video' },
  { value: 'stream', labelKey: 'source.stream' },
  { value: 'desktop', labelKey: 'source.desktop' },
];

async function updateEditingSource(changes: Partial<SourceConfig>): Promise<void> {
  if (!editingItemId.value) return;
  await studio.updatePlaylistItemSource(props.index, editingItemId.value, changes);

  const needsRestart = 'kind' in changes || 'src' in changes || 'serverId' in changes || 'camera' in changes || 'desktopSourceId' in changes;
  if (needsRestart) {
    const currentItem = playlist.value.items.find(i => i.id === editingItemId.value);
    if (currentItem) {
      tempSource.value?.stop();
      tempSource.value = createSource(currentItem.source, { servers: studio.config?.servers ?? [] });
      await tempSource.value?.start();
    }
  }
}

async function pickEditingFile(): Promise<void> {
  const file = await window.minecube.pickFile();
  if (!file) return;
  await updateEditingSource({ kind: kindForFile(file), src: file, crop: { ...FULL_CROP } });
}

async function editItem(item: PlaylistItem): Promise<void> {
  editingItemId.value = item.id;
  editingCrop.value = { ...(item.source.crop ?? FULL_CROP) };
  tempSource.value = createSource(item.source, { servers: studio.config?.servers ?? [] });
  await tempSource.value?.start();
}

function closeEdit(): void {
  tempSource.value?.stop();
  tempSource.value = null;
  editingItemId.value = null;
}

function saveCrop(crop: CropRect): void {
  editingCrop.value = { ...crop };
  if (!editingItemId.value) return;
  studio.updatePlaylistItemSource(props.index, editingItemId.value, { crop });
}

async function addNewItem(): Promise<void> {
  const countBefore = playlist.value.items.length;
  await studio.addCurrentToPlaylist(props.index);
  await nextTick();

  const newItem = playlist.value.items[0];
  if (newItem && playlist.value.items.length > countBefore) {
    await editItem(newItem);
  }
}

async function handleToggleCarousel(checked: boolean): Promise<void> {
  if (checked && playlist.value.items.length === 0) {
    await studio.addCurrentToPlaylist(props.index);
  } else {
    await studio.setPlaylist(props.index, { enabled: checked });
  }
}
</script>

<template>
  <div class="space-y-2 rounded-md border border-slate-800 bg-slate-950/60 p-2">
    <div class="flex items-center justify-between gap-2 text-xs">
      <label class="flex items-center gap-1.5 text-slate-300">
        <input
          type="checkbox"
          class="accent-violet-500"
          :checked="playlist.enabled"
          @change="handleToggleCarousel(($event.target as HTMLInputElement).checked)"
        />
        {{ t('presets.carousel') }}
      </label>
    </div>

    <template v-if="playlist.enabled">
      <div class="mt-2 flex justify-end">
        <button
          class="w-full rounded-md border border-slate-700 bg-slate-900/50 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
          @click="addNewItem"
        >
          {{ t('playlist.addItem') }}
        </button>
      </div>

      <p v-if="!playlist.items.length" class="text-[11px] text-slate-500">
        {{ t('playlist.empty') }}
      </p>

      <ol v-else class="space-y-1">
        <li
          v-for="(item, at) in playlist.items"
          :key="item.id"
          class="flex items-center gap-1 rounded px-1.5 py-1 text-[11px]"
          :class="item.id === currentItemId ? 'bg-violet-500/15 text-violet-200' : 'text-slate-400'"
        >
          <span class="w-4 shrink-0 text-right tabular-nums text-slate-600">{{ at + 1 }}</span>
          <span class="min-w-0 flex-1 truncate" :title="item.source.src || item.source.camera">
            {{ itemLabel(item) }}
          </span>
          <button
            class="shrink-0 px-1 text-slate-500 hover:text-amber-400"
            :title="t('panel.cropEdit')"
            @click="editItem(item)"
          >
            ✎
          </button>
          <button
            class="shrink-0 px-1 text-slate-500 hover:text-slate-200 disabled:opacity-30"
            :disabled="at === 0"
            :title="t('playlist.moveUp')"
            @click="studio.movePlaylistItem(index, item.id, -1)"
          >
            ↑
          </button>
          <button
            class="shrink-0 px-1 text-slate-500 hover:text-slate-200 disabled:opacity-30"
            :disabled="at === playlist.items.length - 1"
            :title="t('playlist.moveDown')"
            @click="studio.movePlaylistItem(index, item.id, 1)"
          >
            ↓
          </button>
          <button
            class="shrink-0 px-1 text-slate-600 hover:text-rose-400"
            :title="t('playlist.remove')"
            @click="studio.removePlaylistItem(index, item.id)"
          >
            ✕
          </button>
        </li>
      </ol>

      <div v-if="playlist.items.length" class="space-y-1.5 border-t border-slate-800 pt-2">
        <label class="flex items-center justify-between gap-2 text-[11px] text-slate-400">
          <span>{{ t('panel.displayDuration') }}</span>
          <span class="flex items-center gap-1">
            <input
              type="number" min="1" max="3600" step="1"
              class="w-16 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-right"
              :value="playlist.dwellSeconds"
              @change="studio.setPlaylist(index, { dwellSeconds: Number(($event.target as HTMLInputElement).value) })"
            />
            {{ t('s') }}
          </span>
        </label>
        <label class="flex items-center gap-1.5 text-[11px] text-slate-400">
          <input
            type="checkbox"
            class="accent-violet-500"
            :checked="playlist.playVideosToEnd"
            @change="studio.setPlaylist(index, { playVideosToEnd: ($event.target as HTMLInputElement).checked })"
          />
          {{ t('panel.playToEnd') }}
        </label>
        <label class="flex items-center gap-1.5 text-[11px] text-slate-400">
          <input
            type="checkbox"
            class="accent-violet-500"
            :checked="playlist.shuffle"
            @change="studio.setPlaylist(index, { shuffle: ($event.target as HTMLInputElement).checked })"
          />
          {{ t('panel.randomOrder') }}
        </label>
        <p v-if="playlist.playVideosToEnd" class="text-[10px] leading-snug text-slate-600">
          {{ t('playlist.videosDwellNote') }}
        </p>
      </div>
    </template>

    <CropEditor
      v-if="editingItemId"
      :source="tempSource"
      :crop="editingCrop"
      :title="editingItem ? (itemLabel(editingItem) + ' — ' + t('panel.cropEdit')) : t('panel.cropEdit')"
      :sourceRotate="editingItem?.source.rotate ?? 0"
      @update="saveCrop"
      @close="closeEdit"
    >
      <template #settings>
        <div v-if="editingItem" class="mt-6 space-y-3 border-t border-slate-800 pt-4">
          <div class="flex gap-2">
            <select
              class="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
              :value="editingItem.source.kind"
              @change="updateEditingSource({ kind: ($event.target as HTMLSelectElement).value as SourceKind })"
            >
              <option v-for="k in KINDS" :key="k.value" :value="k.value">{{ t(k.labelKey) }}</option>
            </select>
            <button
              v-if="['image', 'gif', 'video'].includes(editingItem.source.kind)"
              class="shrink-0 rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
              @click="pickEditingFile"
            >
              {{ t('studio.chooseFile') }}
            </button>
          </div>

          <div v-if="editingItem.source.kind === 'color'" class="flex items-center gap-2">
            <input
              type="color"
              class="h-7 w-12 rounded border border-slate-700 bg-slate-950"
              :value="editingItem.source.color ?? '#ff0000'"
              @input="updateEditingSource({ color: ($event.target as HTMLInputElement).value })"
            />
            <span class="font-mono text-xs text-slate-400">{{ editingItem.source.color ?? '#ff0000' }}</span>
          </div>

          <template v-if="editingItem.source.kind === 'stream'">
            <select
              class="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
              :value="editingItem.source.serverId ?? ''"
              @change="updateEditingSource({ serverId: ($event.target as HTMLSelectElement).value || undefined, camera: undefined })"
            >
              <option value="">{{ t('panel.selectServer') }}</option>
              <option v-for="s in servers" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>

            <div class="flex gap-2">
              <select
                class="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
                :value="editingItem.source.camera ?? ''"
                :disabled="!editingItem.source.serverId"
                @change="updateEditingSource({ camera: ($event.target as HTMLSelectElement).value || undefined })"
              >
                <option value="">{{ t('panel.selectCamera') }}</option>
                <option v-for="cam in camerasForEditing" :key="cam.name" :value="cam.name">{{ cam.label }}</option>
              </select>
              <button
                class="shrink-0 rounded-md border border-slate-700 px-2 py-1.5 text-xs hover:bg-slate-800"
                :disabled="!editingItem.source.serverId"
                :title="t('panel.reloadCameras')"
                @click="editingItem.source.serverId && studio.loadCameras(editingItem.source.serverId)"
              >
                ↻
              </button>
            </div>
          </template>

          <template v-if="editingItem.source.kind === 'desktop'">
            <div class="flex gap-2">
              <select
                class="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
                :value="editingItem.source.desktopSourceId ?? ''"
                @change="updateEditingSource({ desktopSourceId: ($event.target as HTMLSelectElement).value || undefined })"
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
          </template>

          <label class="flex items-center justify-between gap-2 text-xs text-slate-300">
            <span>{{ t('playlist.customDwell') }} <span class="text-[10px] text-slate-500">{{ t('playlist.customDwellDefault') }}</span></span>
            <span class="flex items-center gap-1">
              <input
                type="number" min="0" max="3600" step="1"
                class="w-16 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-right text-slate-200"
                :value="editingItem.dwellSeconds ?? 0"
                @change="studio.updatePlaylistItem(index, editingItem.id, { dwellSeconds: Number(($event.target as HTMLInputElement).value) || undefined })"
              />
              {{ t('s') }}
            </span>
          </label>

          <div class="flex gap-2">
            <select
              class="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-300"
              :value="editingItem.source.fit ?? 'cover'"
              @change="updateEditingSource({ fit: ($event.target as HTMLSelectElement).value as 'cover' })"
            >
              <option value="cover">{{ t('panel.fitCrop') }}</option>
              <option value="contain">{{ t('panel.fitContain') }}</option>
              <option value="stretch">{{ t('panel.fitStretch') }}</option>
            </select>
            <select
              class="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-300"
              :value="editingItem.source.rotate ?? 0"
              @change="updateEditingSource({ rotate: Number(($event.target as HTMLSelectElement).value) as 0 })"
            >
              <option :value="0">0° {{ t('playlist.rotated') }}</option>
              <option :value="90">90° {{ t('playlist.rotated') }}</option>
              <option :value="180">180° {{ t('playlist.rotated') }}</option>
              <option :value="270">270° {{ t('playlist.rotated') }}</option>
            </select>
          </div>
        </div>
      </template>
    </CropEditor>
  </div>
</template>
