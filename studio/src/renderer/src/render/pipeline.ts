/**
 * The frame loop.
 *
 * Per tick it asks each slot's compositor to repaint. A repaint only happens
 * when something actually changed, so a still image settles at zero work per
 * tick and only video, GIFs and streams keep the encoder busy.
 */
import { reactive } from 'vue';

import { stripJpegAppSegments } from '@shared/jpeg';
import { buildOrder, shouldAdvance } from '@shared/playlist';
import type { AppConfig, Dashboard, PlaylistItem, SlotConfig, SourceConfig } from '@shared/types';
import { FULL_CROP, MAX_JPEG_BYTES, PANEL_HEIGHT, PANEL_WIDTH } from '@shared/types';

import { PanelCanvas, type Overlay } from './compositor';
import { getDashboard } from './dashboard/registry';
import { ensureMetricsStore, subscribeMetrics } from './metrics-store';
import { registerBuiltinSources } from './sources/builtins';
import { createSource, sameSource, type FrameSource, type SourceContext } from './sources/types';

registerBuiltinSources();

const FULL_VIEWPORT = { x: 0, y: 0, w: 1, h: 1, rotate: 0, flipH: false, flipV: false } as const;

export interface SlotRuntime {
  canvas: PanelCanvas;
  source: FrameSource | null;
  /** Config the current source was built from, so we can tell when to rebuild. */
  sourceConfig: SourceConfig | null;
  /** Drawn on top of the content; setup mode uses it for the big numbers. */
  overlay: Overlay | null;
  overlayKey: string;
  busy: boolean;
  error: string | null;
  /**
   * Quality actually used for this slot. Starts at the configured value and
   * backs off if the panel's chunk budget cannot hold the frame, so a busy
   * camera image does not have to be encoded twice on every single frame.
   */
  quality: number | null;
  /**
   * Bumped on every repaint. The cube preview watches this so it only re-uploads
   * a texture that actually changed -- otherwise a still image would cost four
   * 2 MB GPU uploads per animation frame.
   */
  version: number;

  // -- carousel ------------------------------------------------------------
  /** Index into the slot's playlist, or -1 when the carousel is off. */
  playlistIndex: number;
  /** Identity of the playlist currently running, to spot real edits. */
  playlistSignature: string;
  /** performance.now() at which the current entry started. */
  itemStartedAt: number;
  /** Playback order; a reshuffle only changes this, not the stored playlist. */
  order: number[];
}

export interface PipelineStats {
  /** Frames pushed to panels in the last second, summed over all slots. */
  fps: number;
  /** Encoded JPEG size of the last frame, per slot. */
  lastBytes: number[];
  /** Milliseconds the last frame took to render and encode. */
  encodeMs: number;
  /** The pipeline runs a timer and generates frames. */
  isRunning: boolean;
  /** Error from the unified source, if any. */
  unifiedError: string | null;
  /**
   * Quality actually used for the last encoded frame, per slot -- null until
   * a slot has encoded at least once. Busy content (a noisy camera feed) can
   * force this well below the configured slider to fit the panel's fixed
   * ~249 KB USB chunk budget; this is what makes that visible instead of the
   * quality setting silently appearing to do nothing.
   */
  actualQuality: (number | null)[];
}

/**
 * The slice of per-slot state the UI renders.
 *
 * SlotRuntime itself is deliberately kept out of Vue's reactivity -- it holds
 * canvases, media elements and decoders that must not be wrapped in proxies --
 * so the handful of fields the interface needs are mirrored here instead.
 * Without this the carousel highlight and error messages never update.
 */
export interface SlotStatus {
  error: string | null;
  /** Position in the carousel, or -1 when it is off. */
  playlistIndex: number;
  /** Id of the playlist entry on screen, so the list can highlight it. */
  currentItemId: string | null;
  sourceWidth: number;
  sourceHeight: number;
  /** True once the source has produced something drawable. */
  hasFrame: boolean;
}

function emptyStatus(): SlotStatus {
  return {
    error: null,
    playlistIndex: -1,
    currentItemId: null,
    sourceWidth: 0,
    sourceHeight: 0,
    hasFrame: false,
  };
}

export class Pipeline {
  readonly slots: SlotRuntime[];
  readonly stats: PipelineStats;
  /** Reactive mirror of {@link SlotStatus}, one per slot. */
  readonly status: SlotStatus[];

  private config: AppConfig | null = null;
  private unifiedSource: FrameSource | null = null;
  private unifiedConfig: SourceConfig | null = null;
  private timer: number | null = null;
  private running = false;
  private framesThisSecond = 0;
  private secondStartedAt = 0;
  /** Last error logged by tick(), so a fault that repeats every frame is only reported once. */
  private lastTickError: string | null = null;
  /** Slot index -> serial of the panel it feeds. */
  private targets: (string | null)[] = [];
  private readonly unsubscribeMetrics: () => void;
  /**
   * A Frigate event rule temporarily wants this slot showing a camera instead
   * of its configured content -- see render/frigate-events.ts. Deliberately
   * not part of AppConfig: it is transient reaction to a live event, not a
   * setting, and must never be written to disk or broadcast as a config change.
   */
  private readonly eventOverrides: (SourceConfig | null)[];

  constructor(slotCount: number) {
    this.eventOverrides = Array.from({ length: slotCount }, () => null);
    this.slots = Array.from({ length: slotCount }, () => ({
      canvas: new PanelCanvas(),
      source: null,
      sourceConfig: null,
      overlay: null,
      overlayKey: '',
      busy: false,
      error: null,
      quality: null,
      version: 0,
      playlistIndex: -1,
      playlistSignature: '',
      itemStartedAt: 0,
      order: [],
    }));
    this.stats = reactive<PipelineStats>({
      fps: 0,
      lastBytes: Array.from({ length: slotCount }, () => 0),
      encodeMs: 0,
      isRunning: false,
      unifiedError: null,
      actualQuality: Array.from({ length: slotCount }, () => null),
    });
    this.status = reactive(Array.from({ length: slotCount }, () => emptyStatus()));

    // A dashboard overlay reads live metric values at draw time rather than
    // carrying its own revision counter, so *something* has to tell affected
    // slots to redraw when a new snapshot arrives. invalidate() is the same
    // mechanism setOverlay() already uses for setup mode's numbers.
    ensureMetricsStore();
    this.unsubscribeMetrics = subscribeMetrics(() => {
      if (!this.config || this.config.layout === 'unified') return;
      for (let i = 0; i < this.config.slots.length; i++) {
        if (this.config.slots[i].overlayDashboardId) this.slots[i].canvas.invalidate();
      }
    });
  }

  /** Copy the UI-visible parts of a slot into its reactive mirror. */
  private syncStatus(index: number, currentItemId: string | null = null): void {
    const slot = this.slots[index];
    const status = this.status[index];
    status.error = slot.error;
    status.playlistIndex = slot.playlistIndex;
    status.sourceWidth = slot.source?.size?.w ?? 0;
    status.sourceHeight = slot.source?.size?.h ?? 0;
    status.hasFrame = slot.source?.frame != null;
    if (currentItemId !== null || slot.playlistIndex < 0) status.currentItemId = currentItemId;
  }

  private context(): SourceContext {
    return { servers: this.config?.servers ?? [] };
  }

  /** Apply a new configuration, rebuilding only the sources that changed. */
  async apply(config: AppConfig): Promise<void> {
    // Quality is an encode-time setting, not a canvas pixel -- the compositor's
    // dirty key has no idea it changed, so a static slot (a colour, a still
    // image) would otherwise never re-encode and the slider would visibly do
    // nothing until the content changes for an unrelated reason.
    const qualityChanged = this.config !== null && this.config.quality !== config.quality;
    this.config = config;
    this.targets = config.slots.map((s) => s.serial);
    if (qualityChanged) {
      for (const slot of this.slots) slot.canvas.invalidate();
    }

    if (config.layout === 'unified') {
      await this.ensureUnified(config.unifiedSource);
      for (const slot of this.slots) {
        slot.playlistIndex = -1; // carousels belong to per-panel mode
        slot.playlistSignature = '';
        slot.order = [];
        await this.disposeSlotSource(slot);
      }
    } else {
      await this.disposeUnified();
      await Promise.all(config.slots.map((cfg, i) => this.ensureSlot(i, cfg)));
    }
    for (const slot of this.slots) slot.canvas.invalidate();
  }

  private async ensureSlot(index: number, cfg: SlotConfig): Promise<void> {
    const slot = this.slots[index];

    // A Frigate event owns this slot right now -- carousel/playlist state is
    // left untouched so it resumes exactly where it was once the event clears
    // and this function is called again with override === null.
    const override = this.eventOverrides[index];
    if (override) {
      await this.activate(index, override, false);
      return;
    }

    const playlist = cfg.playlist;
    const running = playlist?.enabled && playlist.items.length > 0;

    if (running) {
      // Restart the carousel only when the playlist itself changed, so editing
      // an unrelated setting does not jump back to the first entry.
      const signature = playlist.items.map((i) => i.id).join(',') + `|${playlist.shuffle}`;
      if (slot.playlistIndex < 0 || slot.playlistSignature !== signature) {
        slot.playlistSignature = signature;
        slot.order = buildOrder(playlist.items.length, playlist.shuffle);
        slot.playlistIndex = 0;
        await this.activate(index, this.itemSource(cfg, slot), true, this.currentItem(cfg, slot).id);
      } else {
        // The playlist order is the same, but the current item's source config might have changed (e.g. crop, fit, kind).
        // activate() handles diffing via sameSource, so it will only restart if the actual source changed.
        await this.activate(index, this.itemSource(cfg, slot), false, this.currentItem(cfg, slot).id);
      }
      return;
    }

    if (slot.playlistIndex >= 0) {
      slot.playlistIndex = -1;
      slot.playlistSignature = '';
      slot.order = [];
      await this.disposeSlotSource(slot);
    }
    await this.activate(index, cfg.source, false);
  }

  /** The carousel entry a slot currently sits on. */
  private currentItem(cfg: SlotConfig, slot: SlotRuntime): PlaylistItem {
    return cfg.playlist.items[slot.order[slot.playlistIndex] ?? 0];
  }

  private itemSource(cfg: SlotConfig, slot: SlotRuntime): SourceConfig {
    // A looping video would never end, so the carousel could never move on.
    return { ...this.currentItem(cfg, slot).source, loop: !cfg.playlist.playVideosToEnd };
  }

  /** Build and start a source, unless an identical one is already running. */
  private async activate(
    index: number,
    source: SourceConfig,
    force: boolean,
    itemId: string | null = null,
  ): Promise<void> {
    const slot = this.slots[index];
    if (!force && slot.sourceConfig && sameSource(slot.sourceConfig, source)) return;
    await this.disposeSlotSource(slot);
    slot.sourceConfig = { ...source };
    // A malformed or no-longer-registered `kind` (a stale config from a
    // removed feature, e.g.) must break only this one slot, not the whole
    // apply() -> Promise.all() chain -- an uncaught rejection here propagates
    // all the way up through studio.init(), which never sets `ready`, and the
    // app is stuck on "Panels werden gesucht…" forever with nothing to click.
    try {
      slot.source = createSource(source, this.context());
      await slot.source.start();
      slot.error = slot.source.error;
    } catch (err) {
      slot.source = null;
      slot.error = err instanceof Error ? err.message : String(err);
    }
    slot.itemStartedAt = performance.now();
    if (slot.error) console.warn(`[pipeline] slot ${index + 1}: ${slot.error}`);
    this.syncStatus(index, itemId);
  }

  /** Move a carousel on if its entry is up, then swap in the next source. */
  private async advancePlaylists(cfg: AppConfig, now: number): Promise<void> {
    await Promise.all(
      cfg.slots.map(async (slotCfg, index) => {
        const slot = this.slots[index];
        // A Frigate event owns this slot right now -- the carousel's own
        // dwell timer must not force its way back in and clobber it. Without
        // this, a running carousel's own itemDwell (e.g. 10-20s) forces a
        // switch via activate(..., force=true) on every tick regardless of
        // any override, since this function calls activate() directly and
        // never goes through ensureSlot()'s override check.
        if (this.eventOverrides[index]) return;
        if (slot.playlistIndex < 0 || slot.busy) return;

        const list = slotCfg.playlist;
        const currentItem = this.currentItem(slotCfg, slot);
        const due = shouldAdvance(list, {
          elapsedSeconds: (now - slot.itemStartedAt) / 1000,
          sourceFinished: slot.source?.finished === true,
          itemDwell: currentItem?.dwellSeconds,
        });
        if (!due) return;

        slot.playlistIndex = (slot.playlistIndex + 1) % slot.order.length;
        // Reshuffle at the wrap so a repeat pass is not the same order again.
        if (slot.playlistIndex === 0 && list.shuffle) {
          slot.order = buildOrder(list.items.length, true);
        }
        const next = this.currentItem(slotCfg, slot);
        await this.activate(index, this.itemSource(slotCfg, slot), true, next.id);
      }),
    );
  }

  private async disposeSlotSource(slot: SlotRuntime): Promise<void> {
    slot.source?.stop();
    slot.source = null;
    slot.sourceConfig = null;
    slot.error = null;
  }

  private async ensureUnified(cfg: SourceConfig): Promise<void> {
    if (this.unifiedConfig && sameSource(this.unifiedConfig, cfg)) return;
    await this.disposeUnified();
    this.unifiedConfig = { ...cfg };
    // Same reasoning as activate(): a bad `kind` must set stats.unifiedError,
    // not throw all the way up through apply() and wedge start-up.
    try {
      this.unifiedSource = createSource(cfg, this.context());
      await this.unifiedSource.start();
      this.stats.unifiedError = this.unifiedSource.error;
    } catch (err) {
      this.unifiedSource = null;
      this.stats.unifiedError = err instanceof Error ? err.message : String(err);
    }
    if (this.stats.unifiedError) console.warn(`[pipeline] unified: ${this.stats.unifiedError}`);
  }

  private async disposeUnified(): Promise<void> {
    this.unifiedSource?.stop();
    this.unifiedSource = null;
    this.unifiedConfig = null;
  }

  /**
   * Force every slot to repaint and re-encode on the next tick, even though
   * nothing about its content changed. Used after the machine wakes from
   * sleep: the panels were re-opened from scratch, and a slot showing a still
   * image would otherwise never push another frame -- the compositor's dirty
   * key is identical, so it would sit there holding a stale picture forever.
   */
  invalidateAll(): void {
    for (const slot of this.slots) slot.canvas.invalidate();
  }

  /**
   * Tear down and rebuild every source from scratch.
   *
   * Needed after the machine wakes: a stream source holds a WebSocket and an
   * RTCPeerConnection (or a long-lived MJPEG response) that the OS quietly
   * drops while asleep, and nothing in the source notices -- there is no
   * reconnect path, so the panel keeps showing the last frame that arrived
   * before the machine slept. invalidateAll() is not enough on its own: it
   * only repaints whatever the now-dead source last produced.
   */
  async restartSources(): Promise<void> {
    const cfg = this.config;
    if (!cfg) return;

    if (cfg.layout === 'unified') {
      await this.disposeUnified();
      await this.ensureUnified(cfg.unifiedSource);
    } else {
      await Promise.all(
        cfg.slots.map(async (slotCfg, index) => {
          // Dropping sourceConfig is what makes ensureSlot's sameSource()
          // check rebuild rather than decide nothing changed.
          await this.disposeSlotSource(this.slots[index]);
          await this.ensureSlot(index, slotCfg);
        }),
      );
    }
    this.invalidateAll();
  }

  setOverlay(index: number, overlay: Overlay | null, key = ''): void {
    const slot = this.slots[index];
    slot.overlay = overlay;
    slot.overlayKey = key;
    slot.canvas.invalidate();
  }

  /**
   * Show `source` on a slot instead of its configured content, or (with
   * `null`) hand the slot back -- ensureSlot() then rebuilds from the current
   * config exactly as if nothing had happened, playlist position included.
   * Individual mode only, same restriction as dashboard overlays: unified
   * mode has no independent per-slot content to override.
   */
  async setEventOverride(index: number, source: SourceConfig | null): Promise<void> {
    this.eventOverrides[index] = source;
    if (!this.config || this.config.layout !== 'individual') return;
    await this.ensureSlot(index, this.config.slots[index]);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stats.isRunning = true;
    this.secondStartedAt = performance.now();
    this.schedule();
  }

  stop(): void {
    this.running = false;
    this.stats.isRunning = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  get isRunning(): boolean {
    return this.stats.isRunning;
  }

  private schedule(): void {
    if (!this.running) return;
    const interval = Math.max(1000 / (this.config?.maxFps ?? 20), 16);
    this.timer = window.setTimeout(() => void this.tick(), interval);
  }

  /**
   * Runs one frame, and -- whatever happens -- makes sure there is a next one.
   *
   * schedule() is the only thing keeping the loop alive. It used to sit at the
   * very end of the frame body, so an exception anywhere before it skipped the
   * call -- and because schedule() drives the loop with `void this.tick()`, the
   * rejection went nowhere: all four panels stayed frozen on their last frame,
   * silently, with a restart as the only way back. Hence the finally.
   */
  private async tick(): Promise<void> {
    try {
      await this.runTick();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Only on change: at 20 fps an error that repeats would bury the console.
      if (this.lastTickError !== message) {
        console.error(`[pipeline] tick failed: ${message}`);
        this.lastTickError = message;
      }
    } finally {
      this.schedule();
    }
  }

  private async runTick(): Promise<void> {
    if (!this.running || !this.config) return;
    const cfg = this.config;
    const unified = cfg.layout === 'unified';

    if (!unified) await this.advancePlaylists(cfg, performance.now());

    await Promise.all(
      this.slots.map(async (slot, index) => {
        // A slot still encoding must not queue a second job on top.
        if (slot.busy) return;

        const slotCfg = cfg.slots[index];
        const source = unified ? this.unifiedSource : slot.source;
        if (!source) return;

        let viewport = slotCfg.viewport;
        if (unified) {
          // Reconstruct the cross mathematically so it is immune to aspect ratio changes.
          // The config stores viewports as percentages, which warp if the video aspect changes.
          const frontSlot = cfg.slots.find(s => s.face === 'front') ?? cfg.slots[0];
          const topSlot = cfg.slots.find(s => s.face === 'top');
          const s_w = frontSlot.viewport.w;
          const crossX = frontSlot.viewport.x - s_w;
          // Use top slot's y as the base crossY, or fallback to front's y minus a square's height
          const aspect = source.size && source.size.h > 0 ? source.size.w / source.size.h : 1;
          const s_h = s_w * aspect;
          const crossY = topSlot ? topSlot.viewport.y : (frontSlot.viewport.y - s_h);

          let vpX = crossX + s_w;
          let vpY = crossY + s_h;
          if (slotCfg.face === 'top') {
            vpX = crossX + s_w;
            vpY = crossY;
          } else if (slotCfg.face === 'left') {
            vpX = crossX;
            vpY = crossY + s_h;
          } else if (slotCfg.face === 'right') {
            vpX = crossX + 2 * s_w;
            vpY = crossY + s_h;
          }
          
          viewport = { ...slotCfg.viewport, x: vpX, y: vpY, w: s_w, h: s_h };
        } else {
          viewport = {
              ...FULL_VIEWPORT,
              rotate: slotCfg.viewport.rotate,
              flipH: slotCfg.viewport.flipH,
              flipV: slotCfg.viewport.flipV,
          };
        }

        const active = unified ? cfg.unifiedSource : (slot.playlistIndex >= 0 ? this.itemSource(slotCfg, slot) : slotCfg.source);
        const fit = active.fit ?? 'cover';
        const crop = active.crop ?? FULL_CROP;
        // Overlay dashboards are an individual-mode feature (see SlotConfig).
        const dashboardOverlay: Dashboard | null = unified ? null : getDashboard(slotCfg.overlayDashboardId);

        let changed = false;
        try {
          changed = slot.canvas.draw(
            source,
            viewport,
            fit,
            crop,
            active.rotate,
            slot.overlay ?? undefined,
            slot.overlayKey,
            dashboardOverlay,
          );
        } catch (err) {
          // A source in a bad state -- a video whose decoder gave up while the
          // GPU was busy elsewhere, say -- must not take the other panels with
          // it. Promise.all rejects on the first failure, so without this one
          // broken slot skips every slot after it on the same pass.
          const message = err instanceof Error ? err.message : String(err);
          if (slot.error !== message) console.error(`[pipeline] slot ${index + 1} draw: ${message}`);
          slot.error = message;
          return;
        }
        if (!changed) return;
        slot.version++;

        const serial = this.targets[index];
        if (!serial) return; // previewing an unassigned slot: draw, do not send

        slot.busy = true;
        try {
          const started = performance.now();
          const jpeg = await this.encodeWithinBudget(slot, cfg.quality);
          this.stats.encodeMs = Math.round((performance.now() - started) * 10) / 10;
          if (!jpeg) return;
          this.stats.lastBytes[index] = jpeg.byteLength;
          this.stats.actualQuality[index] = slot.quality;
          window.minecube.sendFrame(serial, jpeg);
          this.framesThisSecond++;
          slot.error = null;
        } catch (err) {
          slot.error = err instanceof Error ? err.message : String(err);
        } finally {
          slot.busy = false;
        }
      }),
    );

    const now = performance.now();
    if (now - this.secondStartedAt >= 1000) {
      this.stats.fps = Math.round((this.framesThisSecond * 1000) / (now - this.secondStartedAt));
      this.framesThisSecond = 0;
      this.secondStartedAt = now;
      // Source size and readiness arrive asynchronously; refresh them once a
      // second rather than on every tick.
      for (let i = 0; i < this.slots.length; i++) this.syncStatus(i, this.status[i].currentItemId);
    }
    // No schedule() here: tick() does it in a finally, so doing it again would
    // leave two timers running and the loop would double on every pass.
  }

  /**
   * Encode so the result fits the panel's 255-chunk budget.
   *
   * The quality that worked is remembered per slot: a detailed camera frame can
   * land near the limit, and re-encoding it from scratch on every frame would
   * double the cost for nothing. It creeps back up towards the configured
   * quality once frames have headroom again.
   */
  private async encodeWithinBudget(slot: SlotRuntime, configured: number): Promise<ArrayBuffer | null> {
    // A lowered setting must take effect immediately; a raised one is allowed
    // to be reached gradually.
    const FLOOR = 0.1;
    let q = Math.min(slot.quality ?? configured, configured);

    // Enough attempts to actually walk from 0.98 down to FLOOR in -0.1 steps
    // (was capped at 5, which only reached 0.58 -- never got anywhere near a
    // 0.3 floor either, let alone this lower one).
    for (let attempt = 0; attempt < 10; attempt++) {
      const blob = await slot.canvas.encode(q);
      if (!blob) return null;
      // Drop Chromium's ICC profile so the frame matches what the panel's own
      // software sends -- see @shared/jpeg.
      const trimmed = stripJpegAppSegments(new Uint8Array(await blob.arrayBuffer()));

      if (trimmed.byteLength <= MAX_JPEG_BYTES) {
        // Comfortably inside the budget: edge back towards what was asked for.
        slot.quality =
          trimmed.byteLength < MAX_JPEG_BYTES * 0.7 ? Math.min(configured, q + 0.02) : q;
        return trimmed.buffer.slice(
          trimmed.byteOffset,
          trimmed.byteOffset + trimmed.byteLength,
        ) as ArrayBuffer;
      }
      q -= 0.1;
      if (q < FLOOR) break;
    }

    slot.quality = FLOOR;
    slot.error = `Bild passt nicht in ${MAX_JPEG_BYTES} Byte`;
    return null;
  }

  async dispose(): Promise<void> {
    this.stop();
    this.unsubscribeMetrics();
    await this.disposeUnified();
    for (const slot of this.slots) await this.disposeSlotSource(slot);
  }
}

export const PANEL_SIZE = { width: PANEL_WIDTH, height: PANEL_HEIGHT };
