/**
 * When a carousel entry is due.
 *
 * Split out from the pipeline so the rule is testable on its own: it is the
 * kind of thing that quietly does the wrong thing (a still that never advances,
 * a video cut off mid-sentence) without ever throwing.
 */
import type { Playlist } from './types';

export interface DwellInput {
  /** Seconds the current entry has been on screen. */
  elapsedSeconds: number;
  /** The current source reported that it played through. */
  sourceFinished: boolean;
  /** The dwell time specific to this item, if any. */
  itemDwell?: number;
}

export function shouldAdvance(playlist: Playlist, input: DwellInput): boolean {
  // Waiting for the video to end must not hang on a still image, which never
  // finishes -- the dwell time therefore stays an upper bound in every case.
  if (playlist.playVideosToEnd && input.sourceFinished) return true;
  return input.elapsedSeconds >= Math.max(1, input.itemDwell ?? playlist.dwellSeconds);
}

/** Fisher-Yates, used when the carousel is set to shuffle. */
export function buildOrder(count: number, shuffle: boolean, rng: () => number = Math.random): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  if (!shuffle) return order;
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
