/**
 * Watches an MQTT broker for Frigate's per-camera topics under
 * `frigate/<camera>/+` and hands parsed events to a callback. Connection
 * lifecycle only -- what a slot does with an event lives in the renderer
 * (render/frigate-events.ts), the same split main/metrics.ts uses for
 * polling vs. render/metrics-store.ts for reacting.
 *
 * Two different payload shapes live under that one wildcard, confirmed
 * against https://docs.frigate.video/integrations/mqtt/ after a live test
 * showed `frigate/<camera>/motion` firing but `frigate/<camera>/person`
 * never triggering anything despite Frigate's own Explore tab showing
 * clean person detections:
 * - `frigate/<camera>/motion` -- payload literally "ON"/"OFF".
 * - `frigate/<camera>/<object_label>` (e.g. "person", "car") -- payload is
 *   an **integer count** of that object currently on camera, not "ON"/"OFF".
 *   An earlier version of this file filtered for the literal strings "ON"
 *   and "OFF" on every topic, which silently dropped every object-count
 *   message ("0", "1", "2", ...) -- motion happened to work by coincidence
 *   because it is the one topic that really does say ON/OFF.
 *
 * `mqtt` (mqtt.js) is a plain TCP/WebSocket client, no subprocess involved --
 * consistent with the rest of this file's neighbours after the CPU-usage
 * investigation in metrics.ts.
 *
 * Connection state is reported back via `onStatus`: a broker that only
 * listens on Frigate's own docker network (unreachable from wherever this
 * app runs) fails silently otherwise, and the only symptom is "nothing
 * happens" with no way to tell that apart from a camera/label typo.
 */
import mqtt, { type MqttClient } from 'mqtt';

import type { AppConfig, FrigateEvent, MqttSettings, MqttStatus } from '@shared/types';

/**
 * Pure so it can be unit-tested without a broker. Returns null for anything
 * that is not a 3-segment `frigate/<camera>/<x>` topic, or whose payload
 * does not parse under that topic's expected shape.
 */
export function parseFrigateMessage(topic: string, payload: string): FrigateEvent | null {
  const parts = topic.split('/');
  if (parts.length !== 3 || parts[0] !== 'frigate') return null;
  const [, camera, label] = parts;
  const text = payload.trim();

  if (label === 'motion') {
    if (text !== 'ON' && text !== 'OFF') return null;
    return { camera, label: 'motion', active: text === 'ON' };
  }

  // Every other frigate/<camera>/<label> topic (object labels like "person",
  // "car", plus the aggregate "all") publishes an integer count.
  // Number('') is 0, not NaN -- an empty payload must not silently parse as "count 0".
  if (text === '') return null;
  const count = Number(text);
  if (!Number.isFinite(count)) return null;
  return { camera, label, active: count > 0 };
}

let client: MqttClient | null = null;
/** The settings the current `client` was built from, so an unrelated config change does not force a reconnect. */
let connectedTo: MqttSettings | null = null;
/**
 * Connecting happens during app startup, before any window (and thus any IPC
 * listener) exists -- a push-only status would lose that first transition.
 * Tracked here so a window that loads later can ask for the current state
 * instead of only hearing about the next change.
 */
let lastStatus: MqttStatus = { state: 'idle' };

export function getMqttStatus(): MqttStatus {
  return lastStatus;
}

function sameSettings(a: MqttSettings | null, b: MqttSettings | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.url === b.url && a.username === b.username && a.password === b.password;
}

function connect(
  settings: MqttSettings,
  onEvent: (event: FrigateEvent) => void,
  emitStatus: (status: MqttStatus) => void,
): void {
  connectedTo = settings;
  emitStatus({ state: 'connecting' });
  const c = mqtt.connect(settings.url, {
    username: settings.username || undefined,
    password: settings.password || undefined,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });
  client = c;

  c.on('connect', () => {
    console.log(`[mqtt] connected to ${settings.url}`);
    emitStatus({ state: 'connected' });
    c.subscribe('frigate/+/+', (err) => {
      if (err) {
        console.warn('[mqtt] subscribe failed:', err.message);
        emitStatus({ state: 'error', message: `Subscribe fehlgeschlagen: ${err.message}` });
      }
    });
  });

  c.on('message', (topic, payload) => {
    const event = parseFrigateMessage(topic, payload.toString('utf8'));
    if (!event) return;
    console.log(`[mqtt] ${topic} = ${payload.toString('utf8').trim()} -> ${event.camera}/${event.label} ${event.active ? 'ON' : 'OFF'}`);
    onEvent(event);
  });

  // mqtt.js retries connection failures itself (reconnectPeriod); surface the
  // failure without tearing the client down mid-retry, so a later successful
  // reconnect still flips status back to 'connected'.
  c.on('error', (err) => {
    console.warn(`[mqtt] error connecting to ${settings.url}:`, err.message);
    emitStatus({ state: 'error', message: err.message });
  });
  c.on('close', () => {
    if (client === c) emitStatus({ state: 'connecting' }); // mqtt.js is about to retry
  });
}

/** Call after every config change -- a no-op unless the broker settings actually differ from what is connected now. */
export function syncMqtt(
  cfg: AppConfig,
  onEvent: (event: FrigateEvent) => void,
  onStatus: (status: MqttStatus) => void,
): void {
  const emitStatus = (status: MqttStatus): void => {
    lastStatus = status;
    onStatus(status);
  };
  if (sameSettings(cfg.mqtt, connectedTo)) return;
  stopMqtt();
  if (cfg.mqtt?.url) connect(cfg.mqtt, onEvent, emitStatus);
  else emitStatus({ state: 'idle' });
}

export function stopMqtt(): void {
  client?.removeAllListeners();
  client?.end(true);
  client = null;
  connectedTo = null;
}
