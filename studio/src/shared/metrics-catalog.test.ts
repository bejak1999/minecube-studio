import { describe, expect, it } from 'vitest';

import { applyUnit, diskMetrics, formatMetric, getUnitOptions, metricUnit } from './metrics-catalog';

describe('formatMetric', () => {
  it('rounds to whole numbers by default', () => {
    expect(formatMetric(57.6, '°C', 0)).toBe('58 °C');
  });

  it('respects requested decimals', () => {
    expect(formatMetric(57.649, '°C', 1)).toBe('57.6 °C');
  });

  it('omits the unit separator when there is no unit', () => {
    expect(formatMetric(3, '', 0)).toBe('3');
  });

  it('shows a dash for a missing or NaN value, never "undefined" or "NaN"', () => {
    expect(formatMetric(undefined, '%', 0)).toBe('–');
    expect(formatMetric(Number.NaN, '%', 0)).toBe('–');
  });

  it('applies a custom template with {v} and {u}', () => {
    expect(formatMetric(4217, 'KB/s', 0, '↓ {v} {u}')).toBe('↓ 4217 KB/s');
  });

  it('substitutes {v} even when the template omits {u}', () => {
    expect(formatMetric(23, '%', 0, '{v}%')).toBe('23%');
  });
});

describe('metricUnit', () => {
  it('finds the unit for a known key', () => {
    expect(metricUnit('cpu.load')).toBe('%');
  });

  it('returns empty for an unknown or undefined key', () => {
    expect(metricUnit('lhm:/intelcpu/0/temperature/0')).toBe('');
    expect(metricUnit(undefined)).toBe('');
  });
});

describe('diskMetrics', () => {
  it('generates one descriptor per stat for each drive', () => {
    const result = diskMetrics([{ letter: 'C', totalGb: 500 }, { letter: 'D', totalGb: 1000 }]);
    expect(result.map((m) => m.key)).toEqual([
      'disk.C.usedPercent',
      'disk.C.usedGb',
      'disk.C.totalGb',
      'disk.D.usedPercent',
      'disk.D.usedGb',
      'disk.D.totalGb',
    ]);
  });

  it('returns nothing for no drives', () => {
    expect(diskMetrics([])).toEqual([]);
  });
});

describe('getUnitOptions', () => {
  it('offers bandwidth units for network keys', () => {
    expect(getUnitOptions('net.rxKbps')?.map((o) => o.key)).toEqual(['KBps', 'MBps', 'Mbps', 'Gbps']);
    expect(getUnitOptions('net.txKbps')).not.toBeNull();
  });

  it('offers size units for any *.usedGb / *.totalGb key, including per-drive ones', () => {
    expect(getUnitOptions('disk.C.totalGb')?.map((o) => o.key)).toEqual(['GB', 'TB']);
    expect(getUnitOptions('mem.usedGb')).not.toBeNull();
  });

  it('returns null for metrics with only one natural unit', () => {
    expect(getUnitOptions('cpu.load')).toBeNull();
    expect(getUnitOptions('disk.C.usedPercent')).toBeNull();
    expect(getUnitOptions(undefined)).toBeNull();
  });
});

describe('applyUnit', () => {
  it('converts KB/s to Mbit/s', () => {
    // 1024 KB/s = 1 MB/s = 8 Mbit/s
    expect(applyUnit('net.rxKbps', 1024, 'Mbps')).toEqual({ value: 8, unit: 'Mbit/s' });
  });

  it('converts GB to TB', () => {
    expect(applyUnit('disk.C.totalGb', 2000, 'TB')).toEqual({ value: 2, unit: 'TB' });
  });

  it('defaults to the first option when no unit is chosen', () => {
    expect(applyUnit('net.rxKbps', 512, undefined)).toEqual({ value: 512, unit: 'KB/s' });
  });

  it('passes the raw value through unchanged for metrics with no unit options', () => {
    expect(applyUnit('cpu.load', 42, undefined)).toEqual({ value: 42, unit: '%' });
  });

  it('preserves an undefined value (no data yet) instead of producing NaN', () => {
    expect(applyUnit('net.rxKbps', undefined, 'Mbps')).toEqual({ value: undefined, unit: 'Mbit/s' });
  });
});
