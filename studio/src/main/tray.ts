/**
 * Tray icon and Windows autostart.
 *
 * The point of both: the cube should light up after a reboot without anyone
 * opening a window. The app therefore keeps running when the window is closed
 * and lives in the tray, and the login entry launches it hidden.
 */
import { app, Menu, nativeImage, Tray, type BrowserWindow, type NativeImage } from 'electron';

/** Set by the login entry so the first launch can stay hidden. */
export const AUTOSTART_FLAG = '--autostart';

export function launchedByAutostart(): boolean {
  return process.argv.includes(AUTOSTART_FLAG);
}

/**
 * The app's isometric cube icon (build/icon-source.svg), pre-rendered to a
 * 32x32 PNG and embedded as base64 -- a `build/` file path would not resolve
 * once packaged (that directory is a build-time input, never bundled into
 * the asar), so the tray icon has to be self-contained in compiled code the
 * same way the window/installer icon comes from the exe's own resources.
 */
const TRAY_ICON_PNG_BASE64 =
  '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';

function trayIcon(): NativeImage {
  return nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_PNG_BASE64}`);
}

export interface TrayHooks {
  show: () => void;
  togglePlayback: () => void;
  quit: () => void;
}

let tray: Tray | null = null;
let playing = true;

export function createTray(hooks: TrayHooks): void {
  if (tray) return;
  tray = new Tray(trayIcon());
  tray.setToolTip('Minecube Studio');
  tray.on('double-click', hooks.show);
  rebuildMenu(hooks);
}

export function setTrayPlaying(value: boolean, hooks: TrayHooks): void {
  if (playing === value) return;
  playing = value;
  rebuildMenu(hooks);
}

function rebuildMenu(hooks: TrayHooks): void {
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Minecube Studio', click: hooks.show },
      { type: 'separator' },
      { label: playing ? 'Stop playback' : 'Start playback', click: hooks.togglePlayback },
      { type: 'separator' },
      { label: 'Quit', click: hooks.quit },
    ]),
  );
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}

/**
 * Register or remove the login entry.
 *
 * A dev build must never register itself: the path points at the Electron
 * binary in node_modules, which would leave a broken entry behind.
 */
export function applyAutostart(enabled: boolean): void {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: [AUTOSTART_FLAG],
  });
}

export function windowShouldStartHidden(startMinimized: boolean): boolean {
  return launchedByAutostart() && startMinimized;
}

/** Bring a window back from the tray. */
export function revealWindow(window: BrowserWindow | null): void {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
