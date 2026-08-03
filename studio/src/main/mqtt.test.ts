import { describe, expect, it } from 'vitest';

import { parseFrigateMessage } from './mqtt';

describe('parseFrigateMessage', () => {
  it('parses motion ON/OFF literally', () => {
    expect(parseFrigateMessage('frigate/front_door/motion', 'ON')).toEqual({
      camera: 'front_door',
      label: 'motion',
      active: true,
    });
    expect(parseFrigateMessage('frigate/front_door/motion', 'OFF')).toEqual({
      camera: 'front_door',
      label: 'motion',
      active: false,
    });
  });

  it('rejects a motion payload that is not exactly ON/OFF', () => {
    expect(parseFrigateMessage('frigate/front_door/motion', '1')).toBeNull();
    expect(parseFrigateMessage('frigate/front_door/motion', 'on')).toBeNull();
  });

  it('treats an object-label topic as an integer count, not ON/OFF', () => {
    // This is the bug that was fixed: Frigate publishes a count here, never "ON"/"OFF".
    expect(parseFrigateMessage('frigate/front_door/person', '1')).toEqual({
      camera: 'front_door',
      label: 'person',
      active: true,
    });
    expect(parseFrigateMessage('frigate/front_door/person', '0')).toEqual({
      camera: 'front_door',
      label: 'person',
      active: false,
    });
  });

  it('treats a count greater than one as still active', () => {
    expect(parseFrigateMessage('frigate/front_door/person', '3')).toEqual({
      camera: 'front_door',
      label: 'person',
      active: true,
    });
  });

  it('handles the aggregate "all" label the same way as any other object label', () => {
    expect(parseFrigateMessage('frigate/front_door/all', '2')).toEqual({
      camera: 'front_door',
      label: 'all',
      active: true,
    });
  });

  it('trims whitespace around the payload', () => {
    expect(parseFrigateMessage('frigate/front_door/person', ' 1 \n')).toEqual({
      camera: 'front_door',
      label: 'person',
      active: true,
    });
  });

  it('rejects a non-numeric payload on an object-label topic', () => {
    expect(parseFrigateMessage('frigate/front_door/person', 'ON')).toBeNull();
    expect(parseFrigateMessage('frigate/front_door/person', '')).toBeNull();
  });

  it('ignores topics outside the frigate/<camera>/<x> shape', () => {
    expect(parseFrigateMessage('frigate/available', 'online')).toBeNull();
    expect(parseFrigateMessage('frigate/front_door/person/active', '1')).toBeNull();
    expect(parseFrigateMessage('homeassistant/binary_sensor/x/config', '{}')).toBeNull();
  });
});
