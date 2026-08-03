/**
 * One-off script: rasterizes icon-source.svg once at full size, then derives
 * every smaller icon size from that single capture via in-memory resize
 * (nativeImage.resize is a plain synchronous image op, not a browser window
 * -- creating/destroying a BrowserWindow per size crashed the renderer in
 * this sandboxed shell, this sidesteps that entirely). Packs the results
 * into icon.ico. Run with: npx electron build/render-icon.mjs
 */
import { app, BrowserWindow } from 'electron';
import { appendFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PNG } from './png-ico.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG = join(__dirname, 'render-log.txt');
writeFileSync(LOG, `start ${new Date().toISOString()}\n`);
function log(msg) {
  appendFileSync(LOG, `${msg}\n`);
}

process.on('uncaughtException', (err) => {
  log(`uncaughtException: ${err.stack || err}`);
  process.exit(1);
});

app.disableHardwareAcceleration();

const MASTER_SIZE = 512;
const SIZES = [16, 24, 32, 48, 64, 128, 256];

async function main() {
  log('awaiting whenReady');
  await app.whenReady();
  log('ready, creating window');

  const win = new BrowserWindow({ width: MASTER_SIZE, height: MASTER_SIZE, show: false, transparent: true, frame: false });
  await win.loadFile(join(__dirname, 'icon-source.svg'));
  log('loaded');
  await new Promise((r) => setTimeout(r, 400));
  const master = await win.webContents.capturePage({ x: 0, y: 0, width: MASTER_SIZE, height: MASTER_SIZE });
  log(`captured master ${JSON.stringify(master.getSize())}`);

  const pngEntries = [];
  for (const size of SIZES) {
    const buf = master.resize({ width: size, height: size, quality: 'best' }).toPNG();
    writeFileSync(join(__dirname, `icon-${size}.png`), buf);
    pngEntries.push({ size, buf });
    log(`wrote icon-${size}.png (${buf.length} bytes)`);
  }

  writeFileSync(join(__dirname, 'icon.png'), pngEntries.find((p) => p.size === 256).buf);
  log('wrote icon.png');

  writeFileSync(join(__dirname, 'icon.ico'), PNG.buildIco(pngEntries));
  log('wrote icon.ico');

  log('done, quitting');
  app.quit();
}

main().catch((err) => {
  log(`FAILED: ${err.stack || err}`);
  app.exit(1);
});
