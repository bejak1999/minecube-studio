import { describe, expect, it } from 'vitest';

import { buildOrder, shouldAdvance } from './playlist';
import { emptyPlaylist, type Playlist } from './types';

function list(over: Partial<Playlist> = {}): Playlist {
  return { ...emptyPlaylist(), dwellSeconds: 10, ...over };
}

describe('shouldAdvance', () => {
  it('waits for the dwell time', () => {
    const p = list({ playVideosToEnd: false });
    expect(shouldAdvance(p, { elapsedSeconds: 9.9, sourceFinished: false })).toBe(false);
    expect(shouldAdvance(p, { elapsedSeconds: 10, sourceFinished: false })).toBe(true);
  });

  it('moves on early when a video has finished', () => {
    const p = list({ playVideosToEnd: true });
    expect(shouldAdvance(p, { elapsedSeconds: 1, sourceFinished: true })).toBe(true);
  });

  it('ignores a finished source when that option is off', () => {
    const p = list({ playVideosToEnd: false });
    expect(shouldAdvance(p, { elapsedSeconds: 1, sourceFinished: true })).toBe(false);
  });

  it('still advances a still image while waiting for videos to end', () => {
    // A still never reports finished, so the dwell time must remain the cap --
    // otherwise a carousel with one image in it would stop forever.
    const p = list({ playVideosToEnd: true });
    expect(shouldAdvance(p, { elapsedSeconds: 10, sourceFinished: false })).toBe(true);
  });

  it('never spins faster than one second per entry', () => {
    const p = list({ dwellSeconds: 0, playVideosToEnd: false });
    expect(shouldAdvance(p, { elapsedSeconds: 0.5, sourceFinished: false })).toBe(false);
    expect(shouldAdvance(p, { elapsedSeconds: 1, sourceFinished: false })).toBe(true);
  });
});

describe('buildOrder', () => {
  it('keeps the given order when shuffle is off', () => {
    expect(buildOrder(4, false)).toEqual([0, 1, 2, 3]);
  });

  it('returns a permutation when shuffle is on', () => {
    const order = buildOrder(6, true);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('is deterministic for a given rng', () => {
    // rng always 0 => every swap targets index 0, rotating the list by one
    expect(buildOrder(4, true, () => 0)).toEqual([1, 2, 3, 0]);
  });

  it('handles empty and single-entry playlists', () => {
    expect(buildOrder(0, true)).toEqual([]);
    expect(buildOrder(1, true)).toEqual([0]);
  });
});
