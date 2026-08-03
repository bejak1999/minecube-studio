/** Config persistence -- a JSON file in Electron's userData directory. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';

import type { AppConfig, CubeFace, SlotConfig } from '@shared/types';
import { emptyPlaylist, SLOT_COUNT } from '@shared/types';

/**
 * A distinct colour per slot on first run, so a fresh install proves the whole
 * chain works -- and tells you which physical panel is which -- before you have
 * picked any media.
 */
const FIRST_RUN_COLORS = ['#00c853', '#2962ff', '#ff6d00', '#d500f9'];

/**
 * The chassis carries displays on front, right, top and left -- the back and
 * the bottom are blank. This is the default assignment; setup mode reorders it.
 */
const DEFAULT_FACES: CubeFace[] = ['front', 'right', 'top', 'left'];

/**
 * Default arrangement: the four panels sit side by side around the cube, so the
 * virtual canvas for unified mode is a 4:1 strip and each slot takes a quarter.
 */
function defaultSlot(index: number): SlotConfig {
  return {
    serial: null,
    label: `Panel ${index + 1}`,
    face: DEFAULT_FACES[index % DEFAULT_FACES.length],
    viewport: { x: index / SLOT_COUNT, y: 0, w: 1 / SLOT_COUNT, h: 1, rotate: 0, flipH: false, flipV: false },
    source: {
      kind: 'color',
      color: FIRST_RUN_COLORS[index % FIRST_RUN_COLORS.length],
      fit: 'cover',
      loop: true,
      muted: true,
      rate: 1,
    },
    playlist: emptyPlaylist(),
    overlayDashboardId: null,
  };
}

export function defaultConfig(): AppConfig {
  return {
    layout: 'individual',
    unifiedSource: { kind: 'none', fit: 'cover', loop: true, muted: true, rate: 1 },
    slots: Array.from({ length: SLOT_COUNT }, (_, i) => defaultSlot(i)),
    servers: [],
    presets: [],
    scenes: [],
    dashboards: [],
    hardwareMonitorUrl: null,
    mqtt: null,
    frigateRules: [],
    quality: 0.9,
    maxFps: 20,
    autostart: false,
    startMinimized: true,
    minimizeToTray: true,
    playOnStart: true,
    language: 'en',
  };
}

/**
 * Overlay `patch` on `base`, ignoring keys whose value is undefined or null.
 *
 * A plain spread lets an explicit null win, which silently turns a default into
 * nothing -- a null `color`, for instance, renders as black rather than as the
 * colour the user picked. `serial` is the one field where null is meaningful.
 */
function mergeDefined<T extends object>(base: T, patch: Partial<T> | undefined, nullable: (keyof T)[] = []): T {
  if (!patch) return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(patch) as [keyof T, T[keyof T]][]) {
    if (value === undefined) continue;
    if (value === null && !nullable.includes(key)) continue;
    out[key] = value;
  }
  return out;
}

/** Merge a persisted file over the defaults so new fields appear on upgrade. */
function reconcile(raw: unknown): AppConfig {
  const base = defaultConfig();
  if (!raw || typeof raw !== 'object') return base;
  const saved = raw as Partial<AppConfig>;

  const slots = base.slots.map((slot, i) => {
    const savedSlot = saved.slots?.[i];
    if (!savedSlot) return slot;
    const merged = mergeDefined(slot, savedSlot, ['serial', 'overlayDashboardId']);
    merged.viewport = mergeDefined(slot.viewport, savedSlot.viewport);
    merged.source = mergeDefined(slot.source, savedSlot.source);
    merged.playlist = mergeDefined(slot.playlist, savedSlot.playlist);
    return merged;
  });

  const out = mergeDefined(base, saved, ['hardwareMonitorUrl', 'mqtt']);
  out.unifiedSource = mergeDefined(base.unifiedSource, saved.unifiedSource);
  out.slots = slots;
  return out;
}

export class ConfigStore {
  private readonly file: string;
  private cache: AppConfig;

  constructor(file = join(app.getPath('userData'), 'config.json')) {
    this.file = file;
    this.cache = this.load();
  }

  private load(): AppConfig {
    let text: string;
    try {
      text = readFileSync(this.file, 'utf8');
    } catch {
      return defaultConfig(); // no config yet -- first run
    }
    try {
      // Strip a UTF-8 BOM: editors and PowerShell add one, and JSON.parse
      // throws on it. Falling back to defaults here looks exactly like "the
      // app ignored my settings", so it must not happen silently.
      return reconcile(JSON.parse(text.replace(/^﻿/, '')));
    } catch (err) {
      console.error(
        `config.json konnte nicht gelesen werden, benutze Standardwerte: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return defaultConfig();
    }
  }

  get(): AppConfig {
    return this.cache;
  }

  set(patch: Partial<AppConfig>): AppConfig {
    this.cache = reconcile({ ...this.cache, ...patch });
    this.save();
    return this.cache;
  }

  /** Write via a temp file so a crash mid-write cannot truncate the config. */
  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.cache, null, 2), 'utf8');
    renameSync(tmp, this.file);
  }
}
