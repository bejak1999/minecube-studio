import { describe, expect, it } from 'vitest';

import { flattenLhmTree, toMetricDescriptors } from './lhm-parse';

/** Shaped like a real LibreHardwareMonitor data.json export. */
const SAMPLE_TREE = {
  Text: 'Sensor',
  Children: [
    {
      Text: 'MYPC',
      Children: [
        {
          Text: 'AMD Ryzen 9',
          Children: [
            {
              Text: 'Temperatures',
              Children: [
                { Text: 'CPU Package', Value: '57,3 °C', SensorId: '/amdcpu/0/temperature/0', Children: [] },
                { Text: 'Core #1', Value: '61,0 °C', Children: [] }, // no SensorId -- older LHM version
              ],
            },
            {
              Text: 'Load',
              Children: [{ Text: 'CPU Total', Value: '23,4 %', SensorId: '/amdcpu/0/load/0', Children: [] }],
            },
          ],
        },
        {
          Text: 'Fan Controller',
          Children: [{ Text: 'Fan #1', Value: '842 RPM', SensorId: '/lpc/nct6798d/fan/0', Children: [] }],
        },
      ],
    },
  ],
};

describe('flattenLhmTree', () => {
  const sensors = flattenLhmTree(SAMPLE_TREE);

  it('finds every leaf sensor across the whole tree', () => {
    expect(sensors).toHaveLength(4);
  });

  it('parses a German-locale comma decimal correctly', () => {
    const cpuPackage = sensors.find((s) => s.id === '/amdcpu/0/temperature/0')!;
    // The historical bug: parseFloat("57,3") stops at the comma and yields 57.
    expect(cpuPackage.value).toBe(57.3);
    expect(cpuPackage.unit).toBe('°C');
  });

  it('parses a value with no decimal separator', () => {
    const fan = sensors.find((s) => s.id === '/lpc/nct6798d/fan/0')!;
    expect(fan.value).toBe(842);
    expect(fan.unit).toBe('RPM');
  });

  it('falls back to a text-based path when SensorId is missing', () => {
    const core1 = sensors.find((s) => s.label.endsWith('Core #1'))!;
    expect(core1.id).toBe('/Sensor/MYPC/AMD Ryzen 9/Temperatures/Core #1');
    expect(core1.value).toBe(61.0);
  });

  it('labels a sensor with its immediate group, not the whole ancestry', () => {
    const load = sensors.find((s) => s.id === '/amdcpu/0/load/0')!;
    expect(load.label).toBe('Load · CPU Total');
  });

  it('skips a leaf whose Value is missing or unparseable', () => {
    const broken = { Text: 'Sensor', Children: [{ Text: 'Weird', Value: 'n/a', Children: [] }] };
    expect(flattenLhmTree(broken)).toEqual([]);
  });

  it('handles a tree with no sensors at all', () => {
    expect(flattenLhmTree({ Text: 'Sensor', Children: [] })).toEqual([]);
  });
});

describe('toMetricDescriptors', () => {
  it('prefixes every key with "lhm:" so it cannot collide with a builtin metric', () => {
    const descriptors = toMetricDescriptors(flattenLhmTree(SAMPLE_TREE));
    expect(descriptors.every((d) => d.key.startsWith('lhm:'))).toBe(true);
    expect(descriptors.every((d) => d.source === 'lhm')).toBe(true);
  });
});
