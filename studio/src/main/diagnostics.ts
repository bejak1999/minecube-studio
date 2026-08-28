/**
 * A persistent log file, for faults that only show up after hours.
 *
 * The packaged app has no visible console, so everything the HID service and
 * the main process print has been effectively invisible -- which is useless
 * for a panel that drops off the USB bus once a day. This writes the same
 * lines to `diagnostics.log` in userData, kept small enough to never become a
 * problem on its own and rotated once so a fault is still readable after the
 * app has been restarted.
 */
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';

const MAX_BYTES = 2 * 1024 * 1024;

let file: string | null = null;

export function diagnosticsPath(): string {
  if (!file) file = join(app.getPath('userData'), 'diagnostics.log');
  return file;
}

/** Rotate to a single `.old` companion so a restart cannot erase the evidence. */
function rotateIfLarge(path: string): void {
  try {
    if (statSync(path).size < MAX_BYTES) return;
    renameSync(path, `${path}.old`);
  } catch {
    // No file yet, or it is in use -- either way, keep logging.
  }
}

export function logDiag(message: string): void {
  const path = diagnosticsPath();
  const line = `${new Date().toISOString()} ${message}\n`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    rotateIfLarge(path);
    appendFileSync(path, line, 'utf8');
  } catch {
    // Logging must never be the thing that breaks the app.
  }
  // Still print it: `npm run dev` shows this, a packaged build does not.
  process.stdout.write(line);
}

export function startDiagnostics(): void {
  logDiag(
    `=== minecube-studio ${app.getVersion()} starting | electron ${process.versions.electron} | ` +
      `${process.platform} ${process.arch} ===`,
  );
}
