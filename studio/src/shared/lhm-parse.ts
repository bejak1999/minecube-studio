/**
 * Parsing for LibreHardwareMonitor's web-server JSON. Pure and Electron-free on
 * purpose, so it can be unit tested without a running app -- see main/lhm.ts
 * for the actual `net.fetch`.
 *
 * The tree looks like:
 *   { Text: "Sensor", Children: [ { Text: "MYPC", Children: [
 *       { Text: "CPU", Children: [
 *         { Text: "Temperatures", Children: [
 *           { Text: "CPU Package", Value: "57,3 °C", SensorId: "/intelcpu/0/temperature/0", Children: [] }
 *         ] }
 *       ] }
 *   ] } ] }
 *
 * `SensorId` is the one field stable across restarts; not every LHM version
 * emits it, so a node without one falls back to a path built from its text
 * ancestry -- stable on one machine, but it will drift if LHM's own grouping
 * changes between versions. Either way it is only ever used as a lookup key,
 * never shown to the user (the label is `Text`).
 */
import type { MetricDescriptor } from './types';

export interface LhmNode {
  Text?: string;
  Value?: string;
  SensorId?: string;
  Children?: LhmNode[];
}

export interface LhmSensor {
  id: string;
  label: string;
  value: number;
  unit: string;
}

/**
 * "57,3 °C" -> { value: 57.3, unit: "°C" }.
 *
 * LibreHardwareMonitor formats numbers with the OS locale, and on a German
 * Windows install (the default this app targets) that means a comma decimal
 * separator. `parseFloat("57,3")` silently stops at the comma and returns 57,
 * not 57.3 -- wrong by enough to matter for a temperature reading -- so the
 * comma is normalised before parsing.
 */
function parseValue(raw: string | undefined): { value: number; unit: string } | null {
  if (!raw) return null;
  const match = /^(-?[\d.,]+)\s*(.*)$/.exec(raw.trim());
  if (!match) return null;
  const value = Number.parseFloat(match[1].replace(',', '.'));
  if (Number.isNaN(value)) return null;
  return { value, unit: match[2].trim() };
}

/** Depth-first walk collecting every leaf that carries a parseable Value. */
export function flattenLhmTree(root: LhmNode): LhmSensor[] {
  const out: LhmSensor[] = [];

  function walk(node: LhmNode, parentText: string | undefined, path: string): void {
    const children = node.Children ?? [];
    const nextPath = node.Text ? `${path}/${node.Text}` : path;

    if (children.length === 0) {
      const parsed = parseValue(node.Value);
      if (parsed) {
        out.push({
          id: node.SensorId || nextPath,
          label: parentText ? `${parentText} · ${node.Text ?? '?'}` : node.Text ?? '?',
          value: parsed.value,
          unit: parsed.unit,
        });
      }
      return;
    }
    for (const child of children) walk(child, node.Text, nextPath);
  }

  walk(root, undefined, '');
  return out;
}

export function toMetricDescriptors(sensors: LhmSensor[]): MetricDescriptor[] {
  return sensors.map((s) => ({ key: `lhm:${s.id}`, label: s.label, unit: s.unit, source: 'lhm' as const }));
}
