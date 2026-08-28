/** Types shared between main process, HID service, preload and renderer. */

export const VENDOR_ID = 0x264a;
export const PRODUCT_ID = 0x22c5;

// Protocol geometry. The renderer needs these too -- it has to keep the JPEG it
// produces inside the panel's chunk budget -- so they live here rather than in
// the main-process-only protocol modules.
export const PANEL_WIDTH = 720;
export const PANEL_HEIGHT = 720;
/** Size of one interrupt report. */
export const PACKET_LEN = 1024;
/** Per-report header in front of the JPEG bytes. */
export const IMAGE_HDR_LEN = 24;
/** JPEG bytes carried by a single report. */
export const CHUNK_DATA = PACKET_LEN - IMAGE_HDR_LEN;
/** The chunk index is one byte, so a JPEG cannot exceed 255 chunks. */
export const MAX_CHUNKS = 255;
export const MAX_JPEG_BYTES = MAX_CHUNKS * CHUNK_DATA;

/** Logical slots. The mapping to physical panels is what setup mode establishes. */
export const SLOT_COUNT = 4;
export type SlotIndex = 0 | 1 | 2 | 3;

/** What the panel reports in its `conn` reply. */
export interface PanelInfo {
  degree: number;
  brightness: number;
  space: number;
  sn: string;
  version: { app: string; firmware: string; sdk: string; hardware: string };
}

/** A panel as enumerated over USB, before any handshake. */
export interface PanelDescriptor {
  /** USB serial -- the only stable identity across replugs and reboots. */
  serial: string;
  /** e.g. "ThermalTake USB1 Device" */
  product: string;
  /** e.g. "USB1" -- the port the panel hangs on, handy as a default label. */
  port: string;
  path: string;
}

export interface PanelStatus extends PanelDescriptor {
  connected: boolean;
  info: PanelInfo | null;
  error: string | null;
}

/** How a panel takes its pixels out of the virtual canvas in unified mode. */
export interface PanelViewport {
  /** Source rectangle in virtual-canvas units, 0..1. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Extra rotation applied on top of the panel's own `degree`, in degrees. */
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
}

/**
 * The region taken out of a source, in normalised source coordinates (0..1).
 * Lets the user pick which part of a wide video ends up on a square panel.
 */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

/**
 * The cube carries four displays: front, right, left and top. Back and bottom
 * are blank panels of the chassis.
 */
export const CUBE_FACES = ['front', 'right', 'back', 'left', 'top', 'bottom'] as const;
export type CubeFace = (typeof CUBE_FACES)[number];
export const MOUNTED_FACES: CubeFace[] = ['front', 'right', 'left', 'top'];

export type SourceKind = 'none' | 'image' | 'video' | 'gif' | 'color' | 'stream' | 'desktop';

/** How a stream is pulled off the server. */
export type StreamMode = 'webrtc' | 'mjpeg';

export interface SourceConfig {
  kind: SourceKind;
  /** File path or URL, depending on `kind`. */
  src?: string;
  /** For `color`. */
  color?: string;
  /** How the source fills a 720x720 panel once cropped. */
  fit?: 'cover' | 'contain' | 'stretch';
  loop?: boolean;
  muted?: boolean;
  /** Playback rate for video. */
  rate?: number;
  /** Region of the source to show; omitted means the whole frame. */
  crop?: CropRect;
  /** Individual rotation for this source (e.g. to fix sideways cameras), applied after viewport rotation. */
  rotate?: 0 | 90 | 180 | 270;

  // -- stream --------------------------------------------------------------
  /** Id of the entry in {@link AppConfig.servers}. */
  serverId?: string;
  /** Stream/camera name as reported by that server. */
  camera?: string;
  streamMode?: StreamMode;

  // -- desktop capture -------------------------------------------------------
  /** Electron desktopCapturer source id, e.g. 'screen:0:0'. */
  desktopSourceId?: string;
}

// ---------------------------------------------------------------------------
// dashboard
// ---------------------------------------------------------------------------

export type WidgetType = 'text' | 'gauge' | 'graph' | 'shape' | 'icon';

export interface WidgetStyle {
  /** Foreground: text, gauge arc, graph line. */
  color: string;
  /** '' means transparent. */
  bgColor: string;
  /** Opacity of the background fill alone (0..1) -- independent of `opacity`, so a solid-colour value/arc can sit over a half-see-through panel. */
  bgOpacity: number;
  /** '' means no border. */
  borderColor: string;
  borderWidth: number;
  /** Corner radius, in panel pixels (0..720 scale). */
  borderRadius: number;
  /** Panel-pixel font size for text/gauge value. */
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  opacity: number;
  align: 'left' | 'center' | 'right';
  /** Colour of the small optional caption (`widget.label`) -- independent of `color`, which is the value's colour. */
  labelColor: string;
  /** Panel-pixel font size of the caption -- independent of `fontSize`, which is the value's size. */
  labelFontSize: number;
}

export function defaultWidgetStyle(): WidgetStyle {
  return {
    color: '#e2e8f0',
    bgColor: '',
    bgOpacity: 1,
    borderColor: '',
    borderWidth: 0,
    borderRadius: 12,
    fontSize: 56,
    fontWeight: 'bold',
    opacity: 1,
    align: 'center',
    labelColor: '#e2e8f0',
    labelFontSize: 18,
  };
}

/**
 * One element on a dashboard canvas.
 *
 * Position/size are normalised (0..1) against the panel's 720x720 area, same
 * convention as {@link CropRect} and {@link PanelViewport}, so widgets scale
 * cleanly if the panel resolution ever changes.
 */
export interface DashboardWidget {
  id: string;
  type: WidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Stacking order; higher draws on top. */
  z: number;

  /** Key into a {@link MetricsSnapshot}, e.g. "cpu.load" or "lhm:/intelcpu/0/temperature/0". */
  metric?: string;
  /** Small caption drawn alongside the value (e.g. "CPU"). */
  label?: string;
  /** Literal text, used when no metric is bound (a plain label/caption widget). */
  text?: string;
  /** Template with {v} for the value and {u} for the unit; defaults to "{v} {u}". */
  format?: string;
  decimals?: number;
  /** Display-unit override key (e.g. "MBps", "TB") -- see metrics-catalog's `getUnitOptions`. Undefined means the metric's natural unit. */
  unit?: string;

  /** Gauge scale, and the default axis range for a graph. */
  min?: number;
  max?: number;
  /** Graph: how many seconds of history to plot. */
  historySeconds?: number;
  /** Graph: draw a smoothed curve through the points instead of straight segments. */
  smooth?: boolean;

  /** shape/icon. */
  shape?: 'rect' | 'circle';
  /** icon: image file path. */
  src?: string;

  style: WidgetStyle;
}

/**
 * A saved dashboard layout.
 *
 * Not a `SourceKind` -- a dashboard is an always-on-top overlay layered over
 * whatever a panel is already showing (image, video, stream, ...), not a
 * mutually-exclusive alternative to it. See `SlotConfig.overlayDashboardId`.
 */
export interface Dashboard {
  id: string;
  name: string;
  widgets: DashboardWidget[];
}

export function newDashboard(name: string): Dashboard {
  return { id: '', name, widgets: [] };
}

// ---------------------------------------------------------------------------
// metrics
// ---------------------------------------------------------------------------

/** One polled snapshot of system metrics, pushed from the main process every second. */
export interface MetricsSnapshot {
  /** Unix ms this snapshot was taken. */
  at: number;
  /** Flat key -> numeric value. Keys prefixed "lhm:" come from LibreHardwareMonitor. */
  values: Record<string, number>;
}

/** How a metric is presented in the properties panel's dropdown. */
export interface MetricDescriptor {
  key: string;
  label: string;
  unit: string;
  /** 'builtin' needs no setup; 'lhm' requires a reachable hardware-monitor URL. */
  source: 'builtin' | 'lhm';
}

/** One mounted drive, as offered in the disk-metric dropdown. */
export interface DiskInfo {
  /** Drive letter without the colon, e.g. "C". */
  letter: string;
  totalGb: number;
}

/** One entry in a panel's carousel. */
export interface PlaylistItem {
  id: string;
  source: SourceConfig;
  /** Individual dwell time for this item, overriding the playlist default. */
  dwellSeconds?: number;
}

/** Carousel: cycle several sources on one panel. */
export interface Playlist {
  enabled: boolean;
  items: PlaylistItem[];
  /** How long each entry stays up. */
  dwellSeconds: number;
  /** Let a video finish rather than cutting it at `dwellSeconds`. */
  playVideosToEnd: boolean;
  shuffle: boolean;
}

export function emptyPlaylist(): Playlist {
  return { enabled: false, items: [], dwellSeconds: 15, playVideosToEnd: true, shuffle: false };
}

/** One logical panel slot in the user's arrangement. */
export interface SlotConfig {
  /** USB serial of the physical panel bound to this slot, null while unassigned. */
  serial: string | null;
  label: string;
  /** Which cube face this panel is mounted on; preview only. */
  face: CubeFace;
  viewport: PanelViewport;
  /** Per-slot content; ignored while the layout is `unified` or the carousel runs. */
  source: SourceConfig;
  playlist: Playlist;
  /**
   * A dashboard drawn on top of whatever `source` (or the active carousel
   * item) is showing -- e.g. a small CPU readout over a live camera feed.
   * Individual mode only; a per-face overlay across a unified motif is not
   * supported. `null` means no overlay.
   *
   * Typed `string | null` rather than optional -- like `serial` -- because a
   * patch needs to be able to *clear* it. `JSON.stringify` drops keys whose
   * value is `undefined`, so an omitted field cannot tell the main process
   * "remove this" from "I did not touch this"; only an explicit `null` can.
   */
  overlayDashboardId: string | null;
}

/** A saved piece of content that can be dropped onto any panel. */
export interface SourcePreset {
  id: string;
  name: string;
  source: SourceConfig;
  playlist?: Playlist;
  overlayDashboardId: string | null;
}

/** A saved arrangement of all four panels. */
export interface ScenePreset {
  id: string;
  name: string;
  layout: LayoutMode;
  unifiedSource: SourceConfig;
  slots: {
    source: SourceConfig;
    playlist: Playlist;
    rotate: PanelViewport['rotate'];
    overlayDashboardId: string | null;
  }[];
}

export type ServerKind = 'go2rtc' | 'frigate';

/** A go2rtc or Frigate instance that can supply camera streams. */
export interface MediaServer {
  id: string;
  name: string;
  kind: ServerKind;
  /** Base URL, e.g. http://192.168.1.10:1984 or http://192.168.1.10:5000 */
  url: string;
}

export interface CameraEntry {
  /** Stream name to pass back to the server. */
  name: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Frigate events
// ---------------------------------------------------------------------------

/** Broker Frigate itself publishes its events to -- the same one its Home Assistant integration listens on. */
export interface MqttSettings {
  /** e.g. mqtt://192.168.1.10:1883 or mqtts://... for TLS. */
  url: string;
  username?: string;
  password?: string;
}

/**
 * Show a camera on a panel while Frigate has an object detected on it, e.g.
 * "person" on the driveway camera pops it onto panel 2 for at least 20s.
 *
 * Driven by Frigate's per-camera topics under `frigate/<camera>/<x>` rather
 * than the combined `frigate/events` JSON stream. Two payload shapes live
 * there -- `motion` is literally "ON"/"OFF", every object label (`person`,
 * `car`, ...) is an integer count -- normalised into one on/off shape by
 * `main/mqtt.ts`'s `parseFrigateMessage` before it ever reaches here.
 */
export interface FrigateEventRule {
  id: string;
  name: string;
  enabled: boolean;
  /** Must be a `servers[]` entry with kind 'frigate' -- that is what publishes these topics. */
  serverId: string;
  /** Frigate's internal camera name, as used in both its MQTT topics and its own stream naming. */
  camera: string;
  /** Object labels that trigger this rule, e.g. ["person", "car"]. Empty means any label Frigate publishes for this camera. */
  labels: string[];
  /** Which panel slot (0-3) shows the camera while triggered. */
  slotIndex: number;
  /** Floor on how long the camera stays up, even if the event ends immediately; it never shows for less than this even if it also never shows for less than the event's actual duration. */
  minSeconds: number;
  streamMode: StreamMode;
}

export function newFrigateEventRule(slotIndex: number): FrigateEventRule {
  return {
    id: '',
    name: '',
    enabled: true,
    serverId: '',
    camera: '',
    labels: ['person'],
    slotIndex,
    minSeconds: 20,
    streamMode: 'webrtc',
  };
}

/** One `frigate/<camera>/<label>` MQTT message, normalised to on/off and pushed from the main process. */
export interface FrigateEvent {
  camera: string;
  label: string;
  /** true = "ON" (motion) or count > 0 (object labels); false = "OFF" or count 0. */
  active: boolean;
}

/**
 * Connection state of the MQTT client, pushed from the main process so the
 * Settings tab can show *why* nothing is happening instead of a silent
 * console.warn nobody sees -- e.g. the broker only listening on Frigate's
 * docker network, not reachable from this machine's LAN.
 */
export type MqttStatus =
  | { state: 'idle' }
  | { state: 'connecting' }
  | { state: 'connected' }
  | { state: 'error'; message: string };

/** A screen or window available for desktop capture. */
export interface ScreenSource {
  id: string;
  name: string;
  thumbnail: string; // data URL
}

export type LayoutMode = 'individual' | 'unified';

export interface AppConfig {
  layout: LayoutMode;
  /** Shared source used when `layout` is `unified`. */
  unifiedSource: SourceConfig;
  slots: SlotConfig[];
  /** go2rtc / Frigate instances available as stream sources. */
  servers: MediaServer[];
  /** Reusable pieces of content, applied to a panel on demand. */
  presets: SourcePreset[];
  /** Saved arrangements of all four panels. */
  scenes: ScenePreset[];
  /** Saved dashboard layouts, assignable to any slot via SlotConfig.overlayDashboardId. */
  dashboards: Dashboard[];
  /**
   * Base URL of a running LibreHardwareMonitor instance with its web server
   * enabled (Options > Remote Web Server), e.g. http://localhost:8085.
   * `null` (not optional, same reason as `mqtt`) so a patch can explicitly
   * clear it, rather than the field just not being mentioned.
   */
  hardwareMonitorUrl: string | null;
  /**
   * MQTT broker to watch for Frigate events. `null` (not optional, same
   * reason as `SlotConfig.overlayDashboardId`) so a patch can explicitly
   * clear it and disconnect, rather than the field just not being mentioned.
   */
  mqtt: MqttSettings | null;
  /** Panels that pop up a camera while Frigate has an object detected on it. */
  frigateRules: FrigateEventRule[];
  quality: number;
  /** Cap on frames pushed per second, per panel. */
  maxFps: number;
  /** Register with Windows to start at login. */
  autostart: boolean;
  /** Launch hidden when started by the autostart entry. */
  startMinimized: boolean;
  /** Closing the window leaves the app running in the tray. */
  minimizeToTray: boolean;
  /** Whether the renderer should start pushing frames on launch. */
  playOnStart: boolean;
  /** Global shortcut to cycle through scenes when minimized. */
  sceneShortcut?: string;
  /** User's preferred language: 'en' for English, 'de' for Deutsch. */
  language: 'en' | 'de';
}

// ---------------------------------------------------------------------------
// messages
// ---------------------------------------------------------------------------

/** Control requests, main process -> HID service. */
export type HidRequest =
  | { type: 'discover' }
  | { type: 'connect'; serials: string[] }
  | { type: 'disconnect'; serials: string[] }
  | { type: 'realtime'; serial: string; enable: boolean }
  /**
   * Drop every open handle and rebuild it from a fresh USB enumeration.
   * Needed after the machine wakes from sleep: Windows re-enumerates the USB
   * tree, which leaves the old hidapi handles dead (and can change a device's
   * path), so a plain reconnect on the existing objects is not enough.
   */
  | { type: 'reconnect' }
  | { type: 'stats' };

export interface HidStats {
  /** Reports written since the service started, per panel serial. */
  writes: Record<string, number>;
  framesSent: Record<string, number>;
  lastError: Record<string, string | null>;
}

export type HidResponse =
  | { type: 'panels'; panels: PanelStatus[] }
  | { type: 'stats'; stats: HidStats }
  | { type: 'error'; message: string };

/**
 * A frame pushed from the renderer straight to the HID service over a
 * MessagePort, bypassing the main process so 80 frames/s do not churn it.
 */
export interface FrameMessage {
  serial: string;
  /** Baseline JPEG, 720x720. */
  jpeg: ArrayBuffer;
}

/** Sent once when the frame port opens, to prove the channel end to end. */
export const PING_SERIAL = '__ping__';

export const IPC = {
  getConfig: 'config:get',
  setConfig: 'config:set',
  discover: 'panels:discover',
  connect: 'panels:connect',
  disconnect: 'panels:disconnect',
  stats: 'panels:stats',
  panelsChanged: 'panels:changed',
  framePort: 'frames:port',
  pickFile: 'dialog:pickFile',
  pickFiles: 'dialog:pickFiles',
  listCameras: 'servers:listCameras',
  /** Main -> renderer: the tray asked for playback to be toggled. */
  trayTogglePlayback: 'tray:togglePlayback',
  /** Main -> renderer: cycle to the next scene. */
  cycleScene: 'app:cycleScene',
  /** Renderer -> main: keep the tray menu in step with the pipeline. */
  reportPlayback: 'app:reportPlayback',
  listScreens: 'desktop:listScreens',
  /** Main -> renderer: a new metrics snapshot, pushed roughly once a second. */
  metricsTick: 'metrics:tick',
  /** Renderer -> main: sensors found on the configured LibreHardwareMonitor. */
  listHardwareSensors: 'metrics:listSensors',
  /** Renderer -> main: mounted drives available as disk-metric sources. */
  listDisks: 'metrics:listDisks',
  /** Main -> renderer: a `frigate/<camera>/<label>` MQTT message arrived. */
  frigateEvent: 'frigate:event',
  /** Main -> renderer: the MQTT connection's state changed. */
  mqttStatus: 'mqtt:status',
  /**
   * Main -> renderer: the machine just woke from sleep. The panels were
   * re-opened from scratch, so every slot has to repaint even if its content
   * did not change -- otherwise a static source never pushes another frame
   * and the panel keeps showing whatever was on it when the machine slept.
   */
  powerResume: 'power:resume',
  /** Renderer -> main: current MQTT connection state, for a window that just loaded. */
  getMqttStatus: 'mqtt:getStatus',
  /** Renderer -> main: reveal diagnostics.log in Explorer. */
  openDiagnostics: 'diag:open',
} as const;
