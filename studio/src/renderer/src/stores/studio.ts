import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';

import type {
  AppConfig,
  CameraEntry,
  CubeFace,
  Dashboard,
  DiskInfo,
  FrigateEvent,
  FrigateEventRule,
  MediaServer,
  MetricDescriptor,
  MqttSettings,
  MqttStatus,
  PanelStatus,
  Playlist,
  ScenePreset,
  ScreenSource,
  SlotConfig,
  SourceConfig,
  PlaylistItem,
} from '@shared/types';
import { diskMetrics } from '@shared/metrics-catalog';
import { emptyPlaylist, newDashboard, newFrigateEventRule, SLOT_COUNT } from '@shared/types';

import { setDashboards } from '@/render/dashboard/registry';
import { handleFrigateEvent, pruneFrigateState } from '@/render/frigate-events';
import { setExtraMetricDescriptors } from '@/render/metrics-store';
import { Pipeline } from '@/render/pipeline';

export type Tab = 'panels' | 'presets' | 'settings';

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Guess the content type from a file name. */
export function kindForFile(path: string): SourceConfig['kind'] {
  const lower = path.toLowerCase();
  if (/\.(gif|webp|avif)$/.test(lower)) return 'gif';
  if (/\.(mp4|webm|mkv|mov|m4v)$/.test(lower)) return 'video';
  return 'image';
}

export const useStudio = defineStore('studio', () => {
  const config = ref<AppConfig | null>(null);
  const panels = ref<PanelStatus[]>([]);
  const busy = ref(false);
  const lastError = ref<string | null>(null);
  const setupMode = ref(false);
  const tab = ref<Tab>('panels');
  /** Camera lists per server id, filled on demand. */
  const cameras = ref<Record<string, CameraEntry[]>>({});
  const cameraErrors = ref<Record<string, string>>({});
  
  const screens = ref<ScreenSource[]>([]);
  const screenError = ref<string | null>(null);

  const mqttStatus = ref<MqttStatus>({ state: 'idle' });
  /** Newest first, capped -- lets the Settings tab show that events are actually arriving, not just theory. */
  const recentFrigateEvents = ref<(FrigateEvent & { at: number })[]>([]);

  const lastSceneIndex = ref(-1);

  const pipeline = shallowRef(new Pipeline(SLOT_COUNT));

  const slots = computed<SlotConfig[]>(() => config.value?.slots ?? []);
  const assignedSerials = computed(() =>
    slots.value.map((s) => s.serial).filter((s): s is string => s !== null),
  );
  const unassignedPanels = computed(() =>
    panels.value.filter((p) => !assignedSerials.value.includes(p.serial)),
  );
  const connectedCount = computed(() => panels.value.filter((p) => p.connected).length);

  function panelFor(slot: SlotConfig): PanelStatus | null {
    return panels.value.find((p) => p.serial === slot.serial) ?? null;
  }

  /**
   * Vue hands out reactive Proxy objects, and structuredClone -- what IPC uses
   * -- refuses to clone a Proxy. The config is plain JSON data, so a round trip
   * through JSON is both correct and the cheapest way to strip the proxies.
   */
  function plain<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  async function patch(changes: Partial<AppConfig>): Promise<void> {
    config.value = await window.minecube.setConfig(plain(changes));
    setDashboards(config.value.dashboards);
    await pipeline.value.apply(config.value);
    pruneFrigateState(config.value, pipeline.value);
  }

  async function updateSlot(index: number, changes: Partial<SlotConfig>): Promise<void> {
    if (!config.value) return;
    const next = config.value.slots.map((slot, i) => (i === index ? { ...slot, ...changes } : slot));
    await patch({ slots: next });
  }

  async function setSlotSource(index: number, source: Partial<SourceConfig>): Promise<void> {
    const current = config.value?.slots[index]?.source;
    if (!current) return;
    await updateSlot(index, { source: { ...current, ...source } });
  }

  /** Bind a physical panel to a slot, clearing it from any slot that had it. */
  async function assign(index: number, serial: string | null): Promise<void> {
    if (!config.value) return;
    const next = config.value.slots.map((slot, i) => {
      if (i === index) return { ...slot, serial };
      return slot.serial === serial && serial !== null ? { ...slot, serial: null } : slot;
    });
    await patch({ slots: next });
  }

  /** Exchange the panels bound to two slots -- the "Swap" of the vendor tool. */
  async function swap(a: number, b: number): Promise<void> {
    if (!config.value) return;
    const next = config.value.slots.map((s) => ({ ...s }));
    [next[a].serial, next[b].serial] = [next[b].serial, next[a].serial];
    await patch({ slots: next });
  }

  async function setFace(index: number, face: CubeFace): Promise<void> {
    await updateSlot(index, { face });
  }

  // -- carousel ------------------------------------------------------------

  async function setPlaylist(index: number, changes: Partial<Playlist>): Promise<void> {
    const current = config.value?.slots[index]?.playlist ?? emptyPlaylist();
    await updateSlot(index, { playlist: { ...current, ...changes } });
  }

  /** Add files to a panel's carousel, turning it on the first time. */
  async function addToPlaylist(index: number, paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const current = config.value?.slots[index]?.playlist ?? emptyPlaylist();
    const items = [
      ...current.items,
      ...paths.map((src) => ({
        id: newId('item'),
        source: {
          kind: kindForFile(src),
          src,
          fit: 'cover' as const,
          loop: true,
          muted: true,
          rate: 1,
        },
      })),
    ];
    await setPlaylist(index, { items, enabled: true });
  }

  async function removePlaylistItem(index: number, itemId: string): Promise<void> {
    const current = config.value?.slots[index]?.playlist;
    if (!current) return;
    await setPlaylist(index, { items: current.items.filter((i) => i.id !== itemId) });
  }

  async function addCurrentToPlaylist(index: number): Promise<void> {
    const current = config.value?.slots[index]?.playlist ?? emptyPlaylist();
    const source = config.value?.slots[index]?.source;
    if (!source || source.kind === 'none') {
      console.warn('[studio] addCurrentToPlaylist: source is empty or none', source);
      return;
    }

    // Deep-clone to strip Vue proxies — IPC would choke on them otherwise.
    const cloned = plain(source);
    const items = [
      {
        id: newId('item'),
        source: { ...cloned, loop: true, muted: true, rate: 1 },
      },
      ...current.items,
    ];
    await setPlaylist(index, { items, enabled: true });
  }

  async function updatePlaylistItemSource(index: number, itemId: string, sourceChanges: Partial<SourceConfig>): Promise<void> {
    const current = config.value?.slots[index]?.playlist;
    if (!current) return;
    const items = current.items.map(i => i.id === itemId ? { ...i, source: { ...i.source, ...sourceChanges } } : i);
    await setPlaylist(index, { items });
  }

  async function updatePlaylistItem(index: number, itemId: string, changes: Partial<PlaylistItem>): Promise<void> {
    const current = config.value?.slots[index]?.playlist;
    if (!current) return;
    const items = current.items.map(i => i.id === itemId ? { ...i, ...changes } : i);
    await setPlaylist(index, { items });
  }

  async function movePlaylistItem(index: number, itemId: string, delta: number): Promise<void> {
    const current = config.value?.slots[index]?.playlist;
    if (!current) return;
    const items = [...current.items];
    const at = items.findIndex((i) => i.id === itemId);
    const to = at + delta;
    if (at < 0 || to < 0 || to >= items.length) return;
    [items[at], items[to]] = [items[to], items[at]];
    await setPlaylist(index, { items });
  }

  // -- presets -------------------------------------------------------------

  /** Save what a panel currently shows so it can be dropped on any panel later. */
  async function savePreset(index: number, name: string): Promise<void> {
    const slot = config.value?.slots[index];
    if (!slot) return;
    const playlist = slot.playlist.enabled ? { ...slot.playlist, items: slot.playlist.items.map(i => ({ ...i })) } : undefined;
    const presets = [
      ...(config.value?.presets ?? []),
      { id: newId('p'), name, source: { ...slot.source }, playlist, overlayDashboardId: slot.overlayDashboardId },
    ];
    await patch({ presets });
  }

  async function applyPreset(presetId: string, index: number): Promise<void> {
    const preset = config.value?.presets.find((p) => p.id === presetId);
    if (!preset) return;
    // Applying a preset overrides the current source, playlist and overlay.
    await updateSlot(index, {
      source: { ...preset.source },
      playlist: preset.playlist
        ? { ...preset.playlist, items: preset.playlist.items.map(i => ({ ...i, id: newId('i') })) }
        : { ...(config.value!.slots[index].playlist ?? emptyPlaylist()), enabled: false },
      overlayDashboardId: preset.overlayDashboardId,
    });
  }

  async function renamePreset(presetId: string, name: string): Promise<void> {
    const presets = (config.value?.presets ?? []).map((p) => (p.id === presetId ? { ...p, name } : p));
    await patch({ presets });
  }

  async function removePreset(presetId: string): Promise<void> {
    await patch({ presets: (config.value?.presets ?? []).filter((p) => p.id !== presetId) });
  }

  // -- scenes --------------------------------------------------------------

  /** Snapshot the whole arrangement: layout, every panel's content and carousel. */
  async function saveScene(name: string): Promise<void> {
    if (!config.value) return;
    const scene: ScenePreset = {
      id: newId('s'),
      name,
      layout: config.value.layout,
      unifiedSource: { ...config.value.unifiedSource },
      slots: config.value.slots.map((s) => ({
        source: { ...s.source },
        playlist: { ...s.playlist, items: s.playlist.items.map((i) => ({ ...i })) },
        rotate: s.viewport.rotate,
        overlayDashboardId: s.overlayDashboardId,
      })),
    };
    await patch({ scenes: [...(config.value.scenes ?? []), scene] });
  }

  async function applyScene(sceneId: string): Promise<void> {
    const scene = config.value?.scenes.find((s) => s.id === sceneId);
    if (!scene || !config.value) return;
    lastSceneIndex.value = config.value.scenes.findIndex((s) => s.id === sceneId);
    const slots = config.value.slots.map((slot, i) => {
      const saved = scene.slots[i];
      if (!saved) return slot;
      return {
        ...slot,
        source: { ...saved.source },
        playlist: { ...saved.playlist },
        viewport: { ...slot.viewport, rotate: saved.rotate },
        overlayDashboardId: saved.overlayDashboardId,
      };
    });
    await patch({ layout: scene.layout, unifiedSource: { ...scene.unifiedSource }, slots });
  }

  async function cycleScene(): Promise<void> {
    if (!config.value || config.value.scenes.length === 0) return;
    lastSceneIndex.value = (lastSceneIndex.value + 1) % config.value.scenes.length;
    await applyScene(config.value.scenes[lastSceneIndex.value].id);
  }

  async function removeScene(sceneId: string): Promise<void> {
    await patch({ scenes: (config.value?.scenes ?? []).filter((s) => s.id !== sceneId) });
  }

  // -- dashboards ------------------------------------------------------------

  const hardwareSensors = ref<MetricDescriptor[]>([]);
  const hardwareSensorError = ref<string | null>(null);
  const disks = ref<DiskInfo[]>([]);

  /** Keeps render.ts's unit lookup (LHM sensors, per-drive disk metrics) in step -- see metrics-store.ts. */
  function refreshExtraMetricDescriptors(): void {
    setExtraMetricDescriptors([...diskMetrics(disks.value), ...hardwareSensors.value]);
  }

  /** Creates and persists a new empty dashboard, returning its id for the editor to open. */
  async function addDashboard(name: string): Promise<string> {
    const dash: Dashboard = { ...newDashboard(name), id: newId('dash') };
    await patch({ dashboards: [...(config.value?.dashboards ?? []), dash] });
    return dash.id;
  }

  async function updateDashboard(dashboard: Dashboard): Promise<void> {
    const dashboards = (config.value?.dashboards ?? []).map((d) => (d.id === dashboard.id ? dashboard : d));
    await patch({ dashboards });
  }

  async function removeDashboard(id: string): Promise<void> {
    await patch({ dashboards: (config.value?.dashboards ?? []).filter((d) => d.id !== id) });
  }

  async function loadHardwareSensors(): Promise<void> {
    hardwareSensorError.value = null;
    try {
      hardwareSensors.value = await window.minecube.listHardwareSensors();
      refreshExtraMetricDescriptors();
    } catch (err) {
      hardwareSensorError.value = err instanceof Error ? err.message : String(err);
    }
  }

  async function loadDisks(): Promise<void> {
    disks.value = await window.minecube.listDisks();
    refreshExtraMetricDescriptors();
  }

  // -- media servers -------------------------------------------------------

  async function saveServers(servers: MediaServer[]): Promise<void> {
    await patch({ servers });
  }

  async function addServer(): Promise<void> {
    const servers = [...(config.value?.servers ?? [])];
    servers.push({
      id: `srv-${Date.now().toString(36)}`,
      name: 'Neuer Server',
      kind: 'go2rtc',
      url: 'http://192.168.1.10:1984',
    });
    await saveServers(servers);
  }

  async function updateServer(id: string, changes: Partial<MediaServer>): Promise<void> {
    const servers = (config.value?.servers ?? []).map((s) => (s.id === id ? { ...s, ...changes } : s));
    await saveServers(servers);
  }

  async function removeServer(id: string): Promise<void> {
    await saveServers((config.value?.servers ?? []).filter((s) => s.id !== id));
    delete cameras.value[id];
    delete cameraErrors.value[id];
  }

  async function loadCameras(id: string): Promise<void> {
    const server = config.value?.servers.find((s) => s.id === id);
    if (!server) return;
    delete cameraErrors.value[id];
    try {
      cameras.value = {
        ...cameras.value,
        [id]: await window.minecube.listCameras(JSON.parse(JSON.stringify(server)) as MediaServer),
      };
    } catch (err) {
      cameraErrors.value = {
        ...cameraErrors.value,
        [id]: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async function loadAllCameras(): Promise<void> {
    await Promise.all((config.value?.servers ?? []).map((s) => loadCameras(s.id)));
  }

  // -- Frigate events --------------------------------------------------------

  async function saveMqtt(settings: MqttSettings | null): Promise<void> {
    await patch({ mqtt: settings });
  }

  async function addFrigateRule(slotIndex: number): Promise<void> {
    const rule: FrigateEventRule = { ...newFrigateEventRule(slotIndex), id: newId('frigate') };
    await patch({ frigateRules: [...(config.value?.frigateRules ?? []), rule] });
  }

  async function updateFrigateRule(id: string, changes: Partial<FrigateEventRule>): Promise<void> {
    const rules = (config.value?.frigateRules ?? []).map((r) => (r.id === id ? { ...r, ...changes } : r));
    await patch({ frigateRules: rules });
  }

  async function removeFrigateRule(id: string): Promise<void> {
    await patch({ frigateRules: (config.value?.frigateRules ?? []).filter((r) => r.id !== id) });
  }

  /** Reveal diagnostics.log in Explorer -- the record of what the panels did before a fault. */
  async function openDiagnostics(): Promise<void> {
    await window.minecube.openDiagnostics();
  }

  async function loadScreens(): Promise<void> {
    screenError.value = null;
    try {
      screens.value = await window.minecube.listScreens();
    } catch (err) {
      screenError.value = err instanceof Error ? err.message : String(err);
      console.error('[studio] loadScreens failed:', screenError.value);
    }
  }

  async function refreshPanels(): Promise<void> {
    panels.value = await window.minecube.discover();
  }

  async function connectAll(): Promise<void> {
    busy.value = true;
    lastError.value = null;
    try {
      panels.value = await window.minecube.discover();
      panels.value = await window.minecube.connect(panels.value.map((p) => String(p.serial)));

      // First run: hand out the panels in USB port order so something shows up.
      if (config.value && config.value.slots.every((s) => s.serial === null)) {
        const next = config.value.slots.map((slot, i) => ({
          ...slot,
          serial: panels.value[i]?.serial ?? null,
        }));
        await patch({ slots: next });
      }
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err);
      console.error('[studio] connectAll failed:', lastError.value);
    } finally {
      busy.value = false;
    }
  }

  /**
   * Rebuild every source after the machine wakes, retrying while the network
   * comes back.
   *
   * The main process already re-opened the panels. On this side the sources
   * have to be rebuilt too: a camera stream's WebSocket and peer connection
   * are dropped while the machine sleeps and never reconnect on their own, so
   * a plain repaint would only re-draw the last frame from before sleeping.
   *
   * The retries matter because Wi-Fi/Ethernet routinely needs several seconds
   * longer than the panels do -- a single attempt right after the wake-up
   * would just fail to reach the camera server and leave the panel dead.
   */
  async function recoverAfterResume(): Promise<void> {
    for (const delayMs of [0, 5000, 15000]) {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      await pipeline.value.restartSources();
      if (!pipeline.value.status.some((s) => s.error)) return;
    }
  }

  async function init(): Promise<void> {
    if (!window.minecube) {
      lastError.value = 'Preload-Bridge fehlt — window.minecube ist nicht verfügbar.';
      console.error('[studio]', lastError.value);
      return;
    }
    config.value = await window.minecube.getConfig();
    setDashboards(config.value.dashboards);
    await pipeline.value.apply(config.value);
    await connectAll();
    void loadAllCameras(); // best effort; a missing server must not block start-up
    void loadScreens();
    if (config.value.hardwareMonitorUrl) void loadHardwareSensors();
    if (config.value.playOnStart) pipeline.value.start();
    window.minecube.reportPlayback(pipeline.value.isRunning);
    window.minecube.onTrayTogglePlayback(() => togglePlayback());
    window.minecube.onCycleScene(() => cycleScene());
    window.minecube.onPowerResume(() => {
      void recoverAfterResume();
      void refreshPanels();
    });
    window.minecube.onFrigateEvent((event) => {
      recentFrigateEvents.value = [{ ...event, at: Date.now() }, ...recentFrigateEvents.value].slice(0, 20);
      if (config.value) handleFrigateEvent(event, config.value, pipeline.value);
    });
    // Connecting happens at app startup, before this window existed to
    // receive the push -- fetch what already happened, then listen for more.
    mqttStatus.value = await window.minecube.getMqttStatus();
    window.minecube.onMqttStatus((status) => {
      mqttStatus.value = status;
    });
  }

  function togglePlayback(): void {
    if (pipeline.value.isRunning) pipeline.value.stop();
    else pipeline.value.start();
    window.minecube.reportPlayback(pipeline.value.isRunning);
  }

  return {
    config,
    panels,
    slots,
    busy,
    lastError,
    setupMode,
    tab,
    cameras,
    cameraErrors,
    screens,
    screenError,
    hardwareSensors,
    hardwareSensorError,
    disks,
    mqttStatus,
    recentFrigateEvents,
    pipeline,
    assignedSerials,
    unassignedPanels,
    connectedCount,
    panelFor,
    patch,
    updateSlot,
    setSlotSource,
    assign,
    swap,
    setFace,
    setPlaylist,
    addToPlaylist,
    addCurrentToPlaylist,
    updatePlaylistItemSource,
    updatePlaylistItem,
    removePlaylistItem,
    movePlaylistItem,
    savePreset,
    applyPreset,
    renamePreset,
    removePreset,
    saveScene,
    applyScene,
    cycleScene,
    removeScene,
    addDashboard,
    updateDashboard,
    removeDashboard,
    loadHardwareSensors,
    loadDisks,
    addServer,
    updateServer,
    removeServer,
    loadCameras,
    loadAllCameras,
    loadScreens,
    openDiagnostics,
    refreshPanels,
    connectAll,
    saveMqtt,
    addFrigateRule,
    updateFrigateRule,
    removeFrigateRule,
    init,
    togglePlayback,
  };
});
