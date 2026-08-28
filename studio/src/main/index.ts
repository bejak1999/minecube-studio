import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, powerMonitor, session, shell, globalShortcut } from 'electron';

import type { AppConfig, CameraEntry, HidRequest, HidResponse, MediaServer } from '@shared/types';
import { IPC } from '@shared/types';

import { ConfigStore } from './config';
import { diagnosticsPath, logDiag, startDiagnostics } from './diagnostics';
import { hidHost } from './hid/host';
import { handleMediaScheme, registerMediaScheme } from './media-protocol';
import { listDisks, listHardwareSensors, reopenNativeMonitors, startMetrics, stopMetrics } from './metrics';
import { getMqttStatus, stopMqtt, syncMqtt } from './mqtt';
import { listCameras } from './servers';
import {
  applyAutostart,
  createTray,
  destroyTray,
  revealWindow,
  setTrayPlaying,
  windowShouldStartHidden,
} from './tray';

// This app is meant to sit in the tray driving four panels unattended. The
// default behaviour for an uncaught exception in the main process is a modal
// "A JavaScript error occurred" dialog that stops everything until someone
// clicks it -- worse than carrying on with one broken subsystem. Log loudly
// and keep the panels running instead.
process.on('uncaughtException', (err) => {
  logDiag(`[main] uncaughtException: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
});
process.on('unhandledRejection', (reason) => {
  logDiag(`[main] unhandledRejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
});

registerMediaScheme(); // must happen before the app is ready

let window: BrowserWindow | null = null;
let config: ConfigStore;
/** Set once the user really wants out, so close-to-tray can be bypassed. */
let quitting = false;
/**
 * Brings the window back out of the off-screen "fake minimized" state, set up
 * by createWindow(). Called directly rather than relying on the window's own
 * `focus` event: while parked off-screen the window has to be *repositioned*
 * to become visible again, and a plain show()/focus() that does not happen to
 * fire that event would leave the user clicking the tray to no effect.
 */
let unparkWindow: (() => void) | null = null;

function showWindow(): void {
  if (unparkWindow) unparkWindow();
  revealWindow(window);
}

const trayHooks = {
  show: showWindow,
  togglePlayback: () => window?.webContents.send(IPC.trayTogglePlayback),
  quit: () => {
    quitting = true;
    app.quit();
  },
};

function broadcastFrigateEvent(event: import('@shared/types').FrigateEvent): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.frigateEvent, event);
}

function broadcastMqttStatus(status: import('@shared/types').MqttStatus): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.mqttStatus, status);
}

/**
 * Rebuild the panel connections after the machine wakes up.
 *
 * Windows re-enumerates the USB tree across a suspend/resume cycle, which
 * kills the open hidapi handles: writes fail from then on and the panels keep
 * showing whatever was on them when the machine went to sleep. The service
 * heals itself when a write fails, but a panel showing *static* content never
 * writes again on its own -- so resume also has to force every slot to
 * repaint. The delay gives the USB stack time to finish enumerating; without
 * it the reconnect races the OS and finds nothing.
 */
function watchPowerResume(): void {
  // Recorded so a panel that dies can be lined up against what the machine was
  // doing at the time -- a sleep cycle is the prime suspect for a USB device
  // that has to be power-cycled to come back.
  powerMonitor.on('suspend', () => logDiag('[power] system suspending'));
  powerMonitor.on('lock-screen', () => logDiag('[power] screen locked'));
  powerMonitor.on('resume', () => {
    logDiag('[power] system resumed');
    // PDH/NVML handles do not reliably survive suspend either -- rebuild them
    // before the next poll rather than after it has already failed once.
    reopenNativeMonitors();
    setTimeout(() => {
      void hidHost
        .send({ type: 'reconnect' })
        .then(() => {
          for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.powerResume);
        })
        .catch((err) => logDiag(`[power] reconnect after resume failed: ${String(err)}`));
    }, 2000);
  });
}

function applyShortcut(shortcut?: string): void {
  globalShortcut.unregisterAll();
  if (shortcut) {
    try {
      globalShortcut.register(shortcut, () => {
        window?.webContents.send(IPC.cycleScene);
      });
    } catch (err) {
      console.warn('Could not register shortcut:', shortcut, err);
    }
  }
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: '#0b1220',
    autoHideMenuBar: true,
    // Only matters for dev (`electron .` otherwise shows Electron's own default
    // icon); a packaged build already gets this baked into the .exe itself via
    // electron-builder's build.win.icon, which Windows uses for the taskbar/
    // title bar regardless of this option.
    icon: join(__dirname, '../../build/icon.png'),
    webPreferences: {
      // electron-vite emits an ESM preload; Electron only loads that from .mjs.
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      // Needed so the renderer can decode local videos and images by path.
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  // ── Fake-minimize: restore + move off-screen ────────────────────────────
  // Chromium halts its internal video decoder pipeline when a window is truly
  // minimized (OS-level iconification), dropping decode rate to ~2fps. No
  // command-line flags can override this. event.preventDefault() does NOT work
  // on the 'minimize' event in Electron.
  //
  // Workaround: let the minimize happen, then immediately restore() the window
  // and move it far off-screen. Chromium sees a normal, non-minimized window
  // and keeps decoding video at full speed.
  let savedBounds: Electron.Rectangle | null = null;
  let fakeMinimized = false;
  /** Guards against our own restore()/focus() calls triggering handlers. */
  let selfRestoring = false;

  /**
   * Park the window off-screen but *shown*, which is the only state where
   * Chromium keeps the renderer running at full speed while nothing is
   * visible to the user. `hide()` and "never shown" are both throttled just
   * as hard as a real minimize, so every path that makes the window go away
   * has to come through here.
   *
   * `hideFromTaskbar` is for the tray paths (close-to-tray, autostart): the
   * window is genuinely gone as far as the user is concerned, so it must not
   * sit in the taskbar. A real minimize keeps its taskbar button -- that is
   * how it gets restored.
   */
  function enterFakeMinimized(hideFromTaskbar = false): void {
    if (!window) return;
    savedBounds = window.getBounds();
    fakeMinimized = true;
    selfRestoring = true;
    if (window.isMinimized()) window.restore();
    window.setSkipTaskbar(hideFromTaskbar);
    window.setPosition(-32000, -32000);
    // showInactive() rather than show(): a window that has never been shown is
    // throttled exactly like a minimized one, but stealing focus at login (or
    // on the way *into* the tray) would be obnoxious.
    window.showInactive();
    window.blur();
    // Keep the guard up long enough for all async events to pass.
    setTimeout(() => { selfRestoring = false; }, 300);
  }

  function bringBack(): void {
    if (!window || !fakeMinimized) return;
    fakeMinimized = false;
    selfRestoring = true;
    if (window.isMinimized()) window.restore();
    // hide() before putting the window back: while it sat off-screen with
    // skipTaskbar set, Windows had it in a tool-window-ish frame state, and
    // simply moving it back on screen keeps that frame -- the title bar comes
    // back without its minimize/maximize buttons. Hiding and re-showing makes
    // Windows rebuild the frame from the restored style.
    window.hide();
    window.setSkipTaskbar(false);
    if (savedBounds) {
      window.setBounds(savedBounds);
      savedBounds = null;
    }
    window.show();
    window.focus();
    // Events from show/focus fire asynchronously; keep the guard up briefly.
    setTimeout(() => { selfRestoring = false; }, 300);
  }

  const startHidden = windowShouldStartHidden(config.get().startMinimized);
  window.on('ready-to-show', () => {
    if (!window) return;
    // Starting hidden must still go through the off-screen state above. Simply
    // never calling show() leaves the renderer throttled to a few frames per
    // second -- the panels then crawl after an autostart until the window is
    // opened and re-minimized by hand, which is what used to put it into this
    // state for the first time.
    if (startHidden) enterFakeMinimized(true);
    else window.show();
  });

  window.on('minimize', () => {
    if (!window) return;
    if (fakeMinimized) {
      // Second taskbar click while fake-minimized → bring window back.
      setImmediate(() => bringBack());
      return;
    }
    setImmediate(() => enterFakeMinimized());
  });

  // User-initiated restore (Alt-Tab, taskbar click).
  window.on('restore', () => {
    if (selfRestoring) return;
    bringBack();
  });

  window.on('focus', () => {
    if (selfRestoring) return;
    bringBack();
  });

  // Let the tray and the second-instance handler reach bringBack() directly.
  unparkWindow = bringBack;

  // Closing puts the app in the tray so the panels keep their content; only an
  // explicit Quit really exits.
  window.on('close', (event) => {
    if (quitting || !config.get().minimizeToTray) return;
    event.preventDefault();
    // Not hide(): a hidden window is throttled by Chromium just like a
    // minimized one, which would drop the panels to a few frames per second
    // for as long as the app sits in the tray.
    enterFakeMinimized(true);
  });

  // Renderer errors are otherwise only visible in DevTools; surface them on the
  // terminal so a failing start-up is diagnosable from the logs.
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const tag = ['debug', 'info', 'warning', 'error'][level] ?? String(level);
    console.log(`[renderer:${tag}] ${message}  (${sourceId}:${line})`);
  });
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[preload] ${preloadPath}: ${error.message}`);
  });

  // DevTools on demand only -- having it open costs real CPU next to a live
  // preview. F12 toggles it.
  window.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') window?.webContents.toggleDevTools();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Hand the renderer its direct line to the HID service once the page exists.
  // A reload re-runs this, and the renderer then needs a fresh port, so the old
  // channel is simply replaced -- but never opened twice for one page load.
  let framePortOpened = false;
  window.webContents.on('did-finish-load', () => {
    if (framePortOpened) return;
    framePortOpened = true;
    try {
      hidHost.openFramePort(window!.webContents);
    } catch (err) {
      console.error('could not open frame port:', err);
    }
  });
  window.webContents.on('did-start-navigation', () => {
    framePortOpened = false;
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.getConfig, () => config.get());

  ipcMain.handle(IPC.setConfig, (_event, patch: Partial<AppConfig>) => {
    const prevShortcut = config.get().sceneShortcut;
    const next = config.set(patch);
    if (patch.autostart !== undefined) applyAutostart(next.autostart);
    if (patch.sceneShortcut !== undefined && patch.sceneShortcut !== prevShortcut) {
      applyShortcut(next.sceneShortcut);
    }
    if (patch.mqtt !== undefined) syncMqtt(next, broadcastFrigateEvent, broadcastMqttStatus);
    return next;
  });

  ipcMain.on(IPC.reportPlayback, (_e, playing: boolean) => setTrayPlaying(playing, trayHooks));

  const forward = (req: HidRequest): Promise<HidResponse> => hidHost.send(req);

  ipcMain.handle(IPC.discover, () => forward({ type: 'discover' }));
  ipcMain.handle(IPC.connect, (_e, serials: string[]) => forward({ type: 'connect', serials }));
  ipcMain.handle(IPC.disconnect, (_e, serials: string[]) => forward({ type: 'disconnect', serials }));
  ipcMain.handle(IPC.stats, () => forward({ type: 'stats' }));

  ipcMain.handle(IPC.listCameras, async (_e, server: MediaServer): Promise<CameraEntry[]> =>
    listCameras(server),
  );

  ipcMain.handle(IPC.listHardwareSensors, () => listHardwareSensors(config.get().hardwareMonitorUrl));
  ipcMain.handle(IPC.listDisks, () => listDisks());
  ipcMain.handle(IPC.getMqttStatus, () => getMqttStatus());

  ipcMain.handle(IPC.openDiagnostics, () => {
    shell.showItemInFolder(diagnosticsPath());
  });

  ipcMain.handle(IPC.listScreens, async (): Promise<import('@shared/types').ScreenSource[]> => {
    const { desktopCapturer } = require('electron');
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 160, height: 90 } });
    return sources.map((s: any) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
  });

  ipcMain.handle(IPC.pickFiles, async () => {
    const result = await dialog.showOpenDialog(window!, {
      title: 'Select media for carousel',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Images & Videos', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'mp4', 'webm', 'mkv', 'mov'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle(IPC.pickFile, async () => {
    const result = await dialog.showOpenDialog(window!, {
      title: 'Select media',
      properties: ['openFile'],
      filters: [
        { name: 'Images & Videos', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'mp4', 'webm', 'mkv', 'mov'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
        { name: 'Videos', extensions: ['mp4', 'webm', 'mkv', 'mov'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return result.canceled ? null : result.filePaths[0];
  });
}

// One instance only -- four panels cannot be driven by two processes at once.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Prevent Chromium from freezing timers or video playback when minimized/hidden
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-background-media-suspend');
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,BackgroundVideoTrackOptimization');
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  // Chromium's own internal C++ logging (distinct from this app's console.log/
  // console.warn, which go through Node's stdout unaffected by this switch) --
  // e.g. a benign but constant "ffmpeg_common.cc: Unsupported pixel format: -1"
  // from its media pipeline probing certain camera/screen-capture formats it
  // does not have a native decoder for and falls back on anyway. Level 3 (FATAL
  // only) silences that noise without hiding an actual crash.
  app.commandLine.appendSwitch('log-level', '3');

  app.on('second-instance', () => showWindow());

  void app.whenReady().then(() => {
    handleMediaScheme();
    startDiagnostics();
    config = new ConfigStore();
    applyAutostart(config.get().autostart);
    applyShortcut(config.get().sceneShortcut);
    hidHost.start();
    registerIpc();
    createTray(trayHooks);

    startMetrics(
      () => config.get(),
      (snapshot) => {
        for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.metricsTick, snapshot);
      },
    );
    syncMqtt(config.get(), broadcastFrigateEvent, broadcastMqttStatus);
    watchPowerResume();

    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      if (permission === 'media') {
        callback(true);
      } else {
        callback(true);
      }
    });

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  // Deliberately no quit here: with the tray active the app is meant to keep
  // driving the panels after the window is gone.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !config?.get().minimizeToTray) {
      quitting = true;
      app.quit();
    }
  });

  app.on('before-quit', () => {
    quitting = true;
    globalShortcut.unregisterAll();
    hidHost.stop();
    stopMetrics();
    stopMqtt();
    destroyTray();
  });
}
