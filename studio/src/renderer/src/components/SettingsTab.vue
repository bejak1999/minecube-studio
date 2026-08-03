<script setup lang="ts">
/**
 * Media servers. Camera lists are fetched by the main process, so a LAN box
 * that sends no CORS headers still works.
 */
import type { FrigateEventRule, MqttSettings, ServerKind, StreamMode } from '@shared/types';
import { computed, ref, onBeforeUnmount } from 'vue';

import { useStudio } from '@/stores/studio';
import { useI18n } from '@/i18n/useI18n';

const studio = useStudio();
const { t } = useI18n();

const KINDS: { value: ServerKind; hintKey: string }[] = [
  { value: 'go2rtc', hintKey: 'settings.mediaServers.hint.go2rtc' },
  { value: 'frigate', hintKey: 'settings.mediaServers.hint.frigate' },
];

function hintFor(kind: ServerKind): string {
  return t(KINDS.find((k) => k.value === kind)?.hintKey ?? '');
}

const STREAM_MODES: { value: StreamMode; labelKey: string }[] = [
  { value: 'webrtc', labelKey: 'stream.webrtc' },
  { value: 'mjpeg', labelKey: 'stream.mjpeg' },
];

const frigateServers = computed(() => (studio.config?.servers ?? []).filter((s) => s.kind === 'frigate'));

function camerasFor(serverId: string): string[] {
  return (studio.cameras[serverId] ?? []).map((c) => c.name);
}

function labelsText(rule: FrigateEventRule): string {
  return rule.labels.join(', ');
}

function setLabelsText(rule: FrigateEventRule, text: string): void {
  const labels = text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  void studio.updateFrigateRule(rule.id, { labels });
}

function slotLabel(index: number): string {
  return studio.config?.slots[index]?.label ?? `Panel ${index + 1}`;
}

function mqttField<K extends keyof MqttSettings>(key: K, value: MqttSettings[K]): void {
  const current: MqttSettings = studio.config?.mqtt ?? { url: '' };
  void studio.saveMqtt({ ...current, [key]: value });
}

const getMqttStatusLabel = (state: string, language: 'en' | 'de'): string => {
  const labels: Record<'en' | 'de', Record<string, string>> = {
    en: {
      idle: 'no broker configured',
      connecting: 'connecting...',
      connected: 'connected',
      error: 'Error',
    },
    de: {
      idle: 'kein Broker konfiguriert',
      connecting: 'verbinde...',
      connected: 'verbunden',
      error: 'Fehler',
    },
  };
  return labels[language][state] ?? labels.en[state];
};
const MQTT_STATUS_COLOR: Record<string, string> = {
  idle: 'text-slate-500',
  connecting: 'text-amber-400',
  connected: 'text-emerald-400',
  error: 'text-rose-400',
};

function eventTime(at: number): string {
  return new Date(at).toLocaleTimeString('de-DE');
}

const recordingShortcut = ref(false);

function startRecordingShortcut(): void {
  recordingShortcut.value = true;
  window.addEventListener('keydown', handleKeydown, { capture: true });
}

function stopRecordingShortcut(): void {
  recordingShortcut.value = false;
  window.removeEventListener('keydown', handleKeydown, { capture: true });
}

function handleKeydown(e: KeyboardEvent): void {
  e.preventDefault();
  e.stopPropagation();

  const isModifierOnly = ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(e.key);
  if (isModifierOnly) return;

  if (e.key === 'Escape' && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
    stopRecordingShortcut();
    return;
  }
  if (e.key === 'Backspace' && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
    studio.patch({ sceneShortcut: undefined });
    stopRecordingShortcut();
    return;
  }

  const parts: string[] = [];
  if (e.ctrlKey) parts.push('CommandOrControl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Super');

  let key = e.key;
  if (key.length === 1) key = key.toUpperCase();
  if (key === ' ') key = 'Space';
  if (key === 'ArrowUp') key = 'Up';
  if (key === 'ArrowDown') key = 'Down';
  if (key === 'ArrowLeft') key = 'Left';
  if (key === 'ArrowRight') key = 'Right';

  parts.push(key);

  studio.patch({ sceneShortcut: parts.join('+') });
  stopRecordingShortcut();
}

onBeforeUnmount(() => {
  stopRecordingShortcut();
});
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-xs font-semibold uppercase tracking-wider text-slate-500">{{ t('settings.mediaServers.title') }}</h2>
        <p class="mt-1 text-xs text-slate-500">
          {{ t('settings.mediaServers.description') }}
        </p>
      </div>
      <button
        class="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500"
        @click="studio.addServer()"
      >
        {{ t('settings.mediaServers.add') }}
      </button>
    </div>

    <p v-if="!studio.config?.servers.length" class="rounded-lg border border-dashed border-slate-700 p-6 text-center text-xs text-slate-500">
      {{ t('settings.mediaServers.empty') }}
    </p>

    <div
      v-for="server in studio.config?.servers ?? []"
      :key="server.id"
      class="space-y-2 rounded-lg border border-slate-800 bg-slate-900/60 p-3"
    >
      <div class="flex gap-2">
        <input
          class="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
          :value="server.name"
          :placeholder="t('settings.mediaServers.name')"
          @change="studio.updateServer(server.id, { name: ($event.target as HTMLInputElement).value })"
        />
        <select
          class="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
          :value="server.kind"
          @change="studio.updateServer(server.id, { kind: ($event.target as HTMLSelectElement).value as ServerKind })"
        >
          <option v-for="k in KINDS" :key="k.value" :value="k.value">{{ k.value }}</option>
        </select>
        <button
          class="rounded-md border border-rose-900 px-2 py-1.5 text-xs text-rose-400 hover:bg-rose-950"
          :title="t('settings.mediaServers.remove')"
          @click="studio.removeServer(server.id)"
        >
          {{ t('settings.mediaServers.remove') }}
        </button>
      </div>

      <input
        class="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs"
        :value="server.url"
        :placeholder="hintFor(server.kind)"
        @change="studio.updateServer(server.id, { url: ($event.target as HTMLInputElement).value.trim() })"
      />

      <div class="flex items-center gap-2">
        <button
          class="rounded-md border border-slate-700 px-2.5 py-1 text-xs hover:bg-slate-800"
          @click="studio.loadCameras(server.id)"
        >
          {{ t('settings.mediaServers.loadCameras') }}
        </button>
        <span v-if="studio.cameraErrors[server.id]" class="truncate text-xs text-rose-400">
          {{ studio.cameraErrors[server.id] }}
        </span>
        <span v-else-if="studio.cameras[server.id]" class="text-xs text-emerald-400">
          {{ studio.cameras[server.id].length }} {{ t('settings.mediaServers.camerasFound') }}
        </span>
        <span v-else class="text-xs text-slate-500">{{ t('settings.mediaServers.notQueried') }}</span>
      </div>

      <ul
        v-if="studio.cameras[server.id]?.length"
        class="flex flex-wrap gap-1 pt-1"
      >
        <li
          v-for="cam in studio.cameras[server.id]"
          :key="cam.name"
          class="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-slate-300"
        >
          {{ cam.label }}
        </li>
      </ul>
    </div>

    <section>
      <h2 class="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{{ t('settings.startup.title') }}</h2>
      <div class="space-y-2 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
        <label class="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            class="accent-violet-500"
            :checked="studio.config?.autostart"
            @change="studio.patch({ autostart: ($event.target as HTMLInputElement).checked })"
          />
          {{ t('settings.startup.autostart') }}
        </label>
        <label class="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            class="accent-violet-500"
            :checked="studio.config?.startMinimized"
            @change="studio.patch({ startMinimized: ($event.target as HTMLInputElement).checked })"
          />
          {{ t('settings.startup.minimized') }}
        </label>
        <label class="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            class="accent-violet-500"
            :checked="studio.config?.minimizeToTray"
            @change="studio.patch({ minimizeToTray: ($event.target as HTMLInputElement).checked })"
          />
          {{ t('settings.startup.minimizeToTray') }}
        </label>
        <p class="text-[11px] leading-snug text-slate-500">
          {{ t('settings.startup.description') }}
        </p>
      </div>
    </section>

    <section>
      <h2 class="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{{ t('settings.shortcuts.title') }}</h2>
      <div class="space-y-2 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
        <div class="flex items-center gap-2 text-xs text-slate-300">
          <span class="flex-1">{{ t('settings.shortcuts.sceneSwitch') }}</span>
          <button
            class="min-w-[150px] rounded-md border border-slate-700 px-3 py-1.5 text-center font-mono text-xs hover:bg-slate-800"
            :class="recordingShortcut ? 'bg-violet-600 border-violet-500 text-white hover:bg-violet-500' : 'bg-slate-950 text-slate-300'"
            @click="recordingShortcut ? stopRecordingShortcut() : startRecordingShortcut()"
          >
            {{ recordingShortcut ? t('settings.shortcuts.recording') : (studio.config?.sceneShortcut || t('settings.shortcuts.notSet')) }}
          </button>
          <button
            v-if="studio.config?.sceneShortcut && !recordingShortcut"
            class="shrink-0 px-2 text-slate-500 hover:text-rose-400"
            :title="t('settings.shortcuts.delete')"
            @click="studio.patch({ sceneShortcut: undefined })"
          >
            ✕
          </button>
        </div>
        <p class="text-[11px] leading-snug text-slate-500">
          {{ t('settings.shortcuts.description') }}
        </p>
      </div>
    </section>

    <section>
      <h2 class="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{{ t('settings.hardware.title') }}</h2>
      <div class="space-y-2 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
        <p class="text-[11px] leading-snug text-slate-500">
          {{ t('settings.hardware.description') }}
        </p>
        <input
          class="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs"
          placeholder="http://localhost:8085"
          :value="studio.config?.hardwareMonitorUrl ?? ''"
          @change="studio.patch({ hardwareMonitorUrl: ($event.target as HTMLInputElement).value.trim() || null })"
        />
        <div class="flex items-center gap-2">
          <button
            class="rounded-md border border-slate-700 px-2.5 py-1 text-xs hover:bg-slate-800"
            :disabled="!studio.config?.hardwareMonitorUrl"
            @click="studio.loadHardwareSensors()"
          >
            {{ t('settings.hardware.loadSensors') }}
          </button>
          <span v-if="studio.hardwareSensorError" class="truncate text-xs text-rose-400">
            {{ studio.hardwareSensorError }}
          </span>
          <span v-else-if="studio.hardwareSensors.length" class="text-xs text-emerald-400">
            {{ studio.hardwareSensors.length }} {{ t('settings.hardware.sensorsFound') }}
          </span>
          <span v-else class="text-xs text-slate-500">{{ t('settings.hardware.notQueried') }}</span>
        </div>
      </div>
    </section>

    <section>
      <h2 class="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{{ t('settings.frigate.title') }}</h2>
      <div class="space-y-2 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
        <p class="text-[11px] leading-snug text-slate-500">
          {{ t('settings.frigate.description') }}
        </p>

        <p v-if="studio.config?.layout === 'unified'" class="rounded-md border border-amber-900/50 bg-amber-950/30 px-2 py-1.5 text-[11px] leading-snug text-amber-400">
          {{ t('settings.frigate.unifiedWarning') }}
        </p>

        <div class="flex items-center gap-1.5 text-xs">
          <span class="h-1.5 w-1.5 rounded-full" :class="{
            'bg-slate-600': studio.mqttStatus.state === 'idle',
            'bg-amber-400': studio.mqttStatus.state === 'connecting',
            'bg-emerald-400': studio.mqttStatus.state === 'connected',
            'bg-rose-400': studio.mqttStatus.state === 'error',
          }" />
          <span :class="MQTT_STATUS_COLOR[studio.mqttStatus.state]">
            {{ getMqttStatusLabel(studio.mqttStatus.state, studio.config?.language ?? 'en') }}
          </span>
          <span v-if="studio.mqttStatus.state === 'error'" class="truncate text-slate-500">
            -- {{ studio.mqttStatus.message }}
          </span>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <input
            class="col-span-2 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs"
            :placeholder="t('settings.frigate.brokerUrl')"
            :value="studio.config?.mqtt?.url ?? ''"
            @change="mqttField('url', ($event.target as HTMLInputElement).value.trim())"
          />
          <input
            class="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
            :placeholder="t('settings.frigate.username')"
            :value="studio.config?.mqtt?.username ?? ''"
            @change="mqttField('username', ($event.target as HTMLInputElement).value)"
          />
          <input
            type="password"
            class="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
            :placeholder="t('settings.frigate.password')"
            :value="studio.config?.mqtt?.password ?? ''"
            @change="mqttField('password', ($event.target as HTMLInputElement).value)"
          />
        </div>
        <button
          v-if="studio.config?.mqtt"
          class="text-[11px] text-slate-500 hover:text-rose-400"
          @click="studio.saveMqtt(null)"
        >
          {{ t('settings.frigate.removeBroker') }}
        </button>

        <p v-if="!frigateServers.length" class="text-[11px] leading-snug text-amber-500/80">
          {{ t('settings.frigate.noServers') }}
        </p>

        <div v-for="rule in studio.config?.frigateRules ?? []" :key="rule.id" class="space-y-1.5 rounded-md border border-slate-800 bg-slate-950/60 p-2">
          <div class="flex items-center gap-2">
            <input
              type="checkbox"
              class="accent-violet-500"
              :checked="rule.enabled"
              title="active"
              @change="studio.updateFrigateRule(rule.id, { enabled: ($event.target as HTMLInputElement).checked })"
            />
            <input
              class="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
              :placeholder="t('settings.frigate.ruleName')"
              :value="rule.name"
              @change="studio.updateFrigateRule(rule.id, { name: ($event.target as HTMLInputElement).value })"
            />
            <button
              class="shrink-0 rounded-md border border-rose-900 px-2 py-1.5 text-xs text-rose-400 hover:bg-rose-950"
              @click="studio.removeFrigateRule(rule.id)"
            >
              {{ t('settings.frigate.removeRule') }}
            </button>
          </div>

          <div class="grid grid-cols-2 gap-1.5">
            <select
              class="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
              :value="rule.serverId"
              @change="studio.updateFrigateRule(rule.id, { serverId: ($event.target as HTMLSelectElement).value, camera: '' })"
            >
              <option value="" disabled>{{ t('settings.frigate.selectServer') }}</option>
              <option v-for="s in frigateServers" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>

            <div class="flex gap-1">
              <select
                class="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
                :value="rule.camera"
                :disabled="!rule.serverId"
                @change="studio.updateFrigateRule(rule.id, { camera: ($event.target as HTMLSelectElement).value })"
              >
                <option value="" disabled>{{ t('settings.frigate.selectCamera') }}</option>
                <option v-for="cam in camerasFor(rule.serverId)" :key="cam" :value="cam">{{ cam }}</option>
              </select>
              <button
                class="shrink-0 rounded-md border border-slate-700 px-2 text-xs hover:bg-slate-800"
                :title="t('settings.frigate.reloadCameras')"
                :disabled="!rule.serverId"
                @click="studio.loadCameras(rule.serverId)"
              >
                ⟳
              </button>
            </div>
          </div>

          <input
            class="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
            :placeholder="t('settings.frigate.labels')"
            :value="labelsText(rule)"
            @change="setLabelsText(rule, ($event.target as HTMLInputElement).value)"
          />

          <div class="grid grid-cols-3 gap-1.5">
            <select
              class="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
              :value="rule.slotIndex"
              @change="studio.updateFrigateRule(rule.id, { slotIndex: Number(($event.target as HTMLSelectElement).value) })"
            >
              <option v-for="i in 4" :key="i - 1" :value="i - 1">{{ slotLabel(i - 1) }}</option>
            </select>
            <label class="flex items-center gap-1 text-[11px] text-slate-400">
              min.
              <input
                type="number" min="1" max="600"
                class="w-full min-w-0 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
                :value="rule.minSeconds"
                @change="studio.updateFrigateRule(rule.id, { minSeconds: Number(($event.target as HTMLInputElement).value) })"
              />
              s
            </label>
            <select
              class="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
              :value="rule.streamMode"
              @change="studio.updateFrigateRule(rule.id, { streamMode: ($event.target as HTMLSelectElement).value as typeof rule.streamMode })"
            >
              <option v-for="m in STREAM_MODES" :key="m.value" :value="m.value">{{ t(m.labelKey) }}</option>
            </select>
          </div>
        </div>

        <button
          class="w-full rounded-md border border-dashed border-slate-700 py-1.5 text-xs text-slate-400 hover:border-violet-500 hover:text-violet-300"
          @click="studio.addFrigateRule(0)"
        >
          {{ t('settings.frigate.addRule') }}
        </button>

        <details class="pt-1">
          <summary class="cursor-pointer text-[11px] text-slate-500 hover:text-slate-300">
            {{ t('settings.frigate.incomingEvents') }} ({{ studio.recentFrigateEvents.length }})
          </summary>
          <p v-if="!studio.recentFrigateEvents.length" class="mt-1.5 text-[11px] text-slate-600">
            {{ t('settings.frigate.noEvents') }}
          </p>
          <ul v-else class="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto font-mono text-[11px]">
            <li v-for="(e, i) in studio.recentFrigateEvents" :key="i" class="flex gap-2 text-slate-400">
              <span class="text-slate-600">{{ eventTime(e.at) }}</span>
              <span class="text-slate-300">{{ e.camera }}/{{ e.label }}</span>
              <span :class="e.active ? 'text-emerald-400' : 'text-slate-500'">{{ e.active ? 'ON' : 'OFF' }}</span>
            </li>
          </ul>
        </details>
      </div>
    </section>

    <section>
      <h2 class="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{{ t('settings.language.title') }}</h2>
      <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
        <p class="mb-2 text-xs text-slate-500">{{ t('settings.language.description') }}</p>
        <select
          class="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-300"
          :value="studio.config?.language ?? 'en'"
          @change="studio.patch({ language: ($event.target as HTMLSelectElement).value as 'en' | 'de' })"
        >
          <option value="en">English</option>
          <option value="de">Deutsch</option>
        </select>
      </div>
    </section>

    <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-500">
      <p class="mb-1 font-medium text-slate-400">{{ t('settings.transmission.title') }}</p>
      <p>
        {{ t('settings.transmission.description') }}
      </p>
    </div>
  </div>
</template>
