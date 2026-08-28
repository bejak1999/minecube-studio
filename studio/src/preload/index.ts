import { contextBridge, ipcRenderer } from 'electron';

import type {
  AppConfig,
  CameraEntry,
  DiskInfo,
  FrigateEvent,
  HidResponse,
  MediaServer,
  MetricDescriptor,
  MetricsSnapshot,
  MqttStatus,
  PanelStatus,
} from '@shared/types';
import { IPC, PING_SERIAL } from '@shared/types';

/**
 * The port type as Electron hands it to a renderer. Spelled this way because
 * `MessagePort` resolves to Node's class here, not the DOM interface.
 */
type RendererPort = Electron.IpcRendererEvent['ports'][number];

/** Resolves once the main process has handed over the port to the HID service. */
let framePort: RendererPort | null = null;
ipcRenderer.on('frames:port', (event) => {
  framePort = event.ports[0];
  framePort.start();
  // Prove the channel end to end before any real frame depends on it.
  framePort.postMessage({ serial: PING_SERIAL, jpeg: new ArrayBuffer(1) });
});

function panelsOf(res: HidResponse): PanelStatus[] {
  if (res.type === 'panels') return res.panels;
  if (res.type === 'error') throw new Error(res.message);
  return [];
}

const api = {
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke(IPC.getConfig),
  setConfig: (patch: Partial<AppConfig>): Promise<AppConfig> => ipcRenderer.invoke(IPC.setConfig, patch),

  discover: async (): Promise<PanelStatus[]> => panelsOf(await ipcRenderer.invoke(IPC.discover)),
  connect: async (serials: string[]): Promise<PanelStatus[]> =>
    panelsOf(await ipcRenderer.invoke(IPC.connect, serials)),
  disconnect: async (serials: string[]): Promise<PanelStatus[]> =>
    panelsOf(await ipcRenderer.invoke(IPC.disconnect, serials)),
  stats: async (): Promise<HidResponse> => ipcRenderer.invoke(IPC.stats),

  pickFile: (): Promise<string | null> => ipcRenderer.invoke(IPC.pickFile),
  pickFiles: (): Promise<string[]> => ipcRenderer.invoke(IPC.pickFiles),

  /** The tray's play/pause entry, forwarded into the renderer. */
  onTrayTogglePlayback: (handler: () => void): void => {
    ipcRenderer.on(IPC.trayTogglePlayback, () => handler());
  },
  /** Global shortcut triggered scene cycle, forwarded into the renderer. */
  onCycleScene: (handler: () => void): void => {
    ipcRenderer.on(IPC.cycleScene, () => handler());
  },
  /** Keeps the tray menu's wording in step with the pipeline. */
  reportPlayback: (playing: boolean): void => {
    ipcRenderer.send(IPC.reportPlayback, playing);
  },

  listCameras: (server: MediaServer): Promise<CameraEntry[]> =>
    ipcRenderer.invoke(IPC.listCameras, server),
  listScreens: (): Promise<import('@shared/types').ScreenSource[]> =>
    ipcRenderer.invoke(IPC.listScreens),

  /** A metrics snapshot, pushed from the main process roughly once a second. */
  onMetrics: (handler: (snapshot: MetricsSnapshot) => void): void => {
    ipcRenderer.on(IPC.metricsTick, (_e, snapshot: MetricsSnapshot) => handler(snapshot));
  },
  listHardwareSensors: (): Promise<MetricDescriptor[]> => ipcRenderer.invoke(IPC.listHardwareSensors),
  listDisks: (): Promise<DiskInfo[]> => ipcRenderer.invoke(IPC.listDisks),

  /** A `frigate/<camera>/<label>` MQTT message, pushed from the main process. */
  onFrigateEvent: (handler: (event: FrigateEvent) => void): void => {
    ipcRenderer.on(IPC.frigateEvent, (_e, event: FrigateEvent) => handler(event));
  },
  getMqttStatus: (): Promise<MqttStatus> => ipcRenderer.invoke(IPC.getMqttStatus),
  /** Show diagnostics.log in Explorer -- the record of what the panels did before a fault. */
  openDiagnostics: (): Promise<void> => ipcRenderer.invoke(IPC.openDiagnostics),
  /** The machine woke from sleep and the panels were re-opened: repaint everything. */
  onPowerResume: (handler: () => void): void => {
    ipcRenderer.on(IPC.powerResume, () => handler());
  },
  /** The MQTT connection's state, pushed whenever it changes. */
  onMqttStatus: (handler: (status: MqttStatus) => void): void => {
    ipcRenderer.on(IPC.mqttStatus, (_e, status: MqttStatus) => handler(status));
  },

  /** True once frames can actually be delivered. */
  hasFramePort: (): boolean => framePort !== null,

  /**
   * Push a finished JPEG at a panel.
   *
   * Deliberately sent without a transfer list. Transferring an ArrayBuffer over
   * this port -- a MessagePort entangled with a MessagePortMain in the HID
   * utility process -- delivers an *empty* message instead of failing, which is
   * a nasty way to lose every frame. Structured clone copies ~50 KB per frame
   * instead, which at the rates involved is a few MB/s and not worth chasing.
   *
   * Throws rather than waiting if the port is missing, so a stalled slot is
   * visible instead of silent.
   */
  sendFrame: (serial: string, jpeg: ArrayBufferLike | Uint8Array): void => {
    if (!framePort) throw new Error('Frame-Port noch nicht verbunden');
    const bytes = jpeg instanceof Uint8Array ? jpeg : new Uint8Array(jpeg as ArrayBuffer);
    framePort.postMessage({ serial, jpeg: bytes });
  },
};

export type MinecubeApi = typeof api;

contextBridge.exposeInMainWorld('minecube', api);
