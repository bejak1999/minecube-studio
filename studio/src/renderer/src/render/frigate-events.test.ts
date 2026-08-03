import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppConfig, FrigateEventRule } from '@shared/types';

import { handleFrigateEvent, pruneFrigateState } from './frigate-events';
import type { Pipeline } from './pipeline';

/** Only the fields handleFrigateEvent/pruneFrigateState actually read. */
function cfg(rules: FrigateEventRule[], servers: AppConfig['servers'] = [{ id: 'srv1', name: 'Frigate', kind: 'frigate', url: 'http://x' }]): AppConfig {
  return { frigateRules: rules, servers } as AppConfig;
}

// `states` inside frigate-events.ts is a module-level singleton, same as in
// the real app -- it outlives any single test. Every test therefore needs
// its OWN slotIndex (not just its own rule id): otherwise a still-active
// leftover rule from an earlier test with the same slotIndex satisfies the
// cross-rule "another rule still holds this slot" guard and silently
// swallows an assertion in a completely unrelated, later test.
let nextSlot = 0;
function rule(overrides: Partial<FrigateEventRule> & { id: string }): FrigateEventRule {
  return {
    name: overrides.id,
    enabled: true,
    serverId: 'srv1',
    camera: 'front_door',
    labels: ['person'],
    slotIndex: nextSlot++,
    minSeconds: 20,
    streamMode: 'webrtc',
    ...overrides,
  };
}

function mockPipeline(): Pipeline & { setEventOverride: ReturnType<typeof vi.fn> } {
  return { setEventOverride: vi.fn().mockResolvedValue(undefined) } as unknown as Pipeline & {
    setEventOverride: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('handleFrigateEvent', () => {
  it('activates the override on a matching ON event', () => {
    const pipeline = mockPipeline();
    const r = rule({ id: 'r1' });
    handleFrigateEvent({ camera: 'front_door', label: 'person', active: true }, cfg([r]), pipeline);

    expect(pipeline.setEventOverride).toHaveBeenCalledWith(r.slotIndex, {
      kind: 'stream',
      serverId: 'srv1',
      camera: 'front_door',
      streamMode: 'webrtc',
      fit: 'cover',
    });
  });

  it('ignores an event for a different camera', () => {
    const pipeline = mockPipeline();
    const config = cfg([rule({ id: 'r2' })]);
    handleFrigateEvent({ camera: 'backyard', label: 'person', active: true }, config, pipeline);
    expect(pipeline.setEventOverride).not.toHaveBeenCalled();
  });

  it('ignores a disabled rule', () => {
    const pipeline = mockPipeline();
    const config = cfg([rule({ id: 'r3', enabled: false })]);
    handleFrigateEvent({ camera: 'front_door', label: 'person', active: true }, config, pipeline);
    expect(pipeline.setEventOverride).not.toHaveBeenCalled();
  });

  it('an empty labels list matches any label', () => {
    const pipeline = mockPipeline();
    const config = cfg([rule({ id: 'r4', labels: [] })]);
    handleFrigateEvent({ camera: 'front_door', label: 'dog', active: true }, config, pipeline);
    expect(pipeline.setEventOverride).toHaveBeenCalledTimes(1);
  });

  it('reverts immediately on OFF once minSeconds has already elapsed', () => {
    const pipeline = mockPipeline();
    const r = rule({ id: 'r5', minSeconds: 5 });
    const config = cfg([r]);
    handleFrigateEvent({ camera: 'front_door', label: 'person', active: true }, config, pipeline);
    vi.advanceTimersByTime(6000);
    handleFrigateEvent({ camera: 'front_door', label: 'person', active: false }, config, pipeline);

    expect(pipeline.setEventOverride).toHaveBeenLastCalledWith(r.slotIndex, null);
  });

  it('holds the override until minSeconds even if the event ends immediately', () => {
    const pipeline = mockPipeline();
    const r = rule({ id: 'r6', minSeconds: 20 });
    const config = cfg([r]);
    handleFrigateEvent({ camera: 'front_door', label: 'person', active: true }, config, pipeline);
    handleFrigateEvent({ camera: 'front_door', label: 'person', active: false }, config, pipeline);

    // Not reverted yet -- only the activation call so far.
    expect(pipeline.setEventOverride).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(19999);
    expect(pipeline.setEventOverride).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(pipeline.setEventOverride).toHaveBeenLastCalledWith(r.slotIndex, null);
  });

  it('cancels a pending revert if the event re-triggers before minSeconds elapses', () => {
    const pipeline = mockPipeline();
    const r = rule({ id: 'r7', minSeconds: 20 });
    const config = cfg([r]);
    handleFrigateEvent({ camera: 'front_door', label: 'person', active: true }, config, pipeline);
    handleFrigateEvent({ camera: 'front_door', label: 'person', active: false }, config, pipeline);
    vi.advanceTimersByTime(5000);
    // Re-triggering briefly passes through "idle" (the OFF already cleared
    // activeLabels), so a second, harmless re-activation call is expected --
    // the pipeline's own sameSource() diffing makes a repeat activation a
    // no-op. What must NOT happen is the pending revert from the first OFF
    // firing later and undoing this re-activation.
    handleFrigateEvent({ camera: 'front_door', label: 'person', active: true }, config, pipeline);

    vi.advanceTimersByTime(20000);
    expect(pipeline.setEventOverride).not.toHaveBeenCalledWith(r.slotIndex, null);
  });

  it('stays active while any one of several matched labels is still ON', () => {
    const pipeline = mockPipeline();
    const config = cfg([rule({ id: 'r8', labels: ['person', 'car'], minSeconds: 1 })]);
    handleFrigateEvent({ camera: 'front_door', label: 'person', active: true }, config, pipeline);
    handleFrigateEvent({ camera: 'front_door', label: 'car', active: true }, config, pipeline);
    handleFrigateEvent({ camera: 'front_door', label: 'person', active: false }, config, pipeline);
    vi.advanceTimersByTime(2000);

    // "car" is still ON -- must not have reverted.
    expect(pipeline.setEventOverride).toHaveBeenCalledTimes(1);
  });

  it('does not let a second rule on the same slot with a shorter minSeconds revert the first rule while it is still active', () => {
    // This is the exact bug reported live: a leftover/duplicate rule created
    // while experimenting with a different label, targeting the same panel,
    // with the 20s default -- its own short timer must not yank the panel
    // out from under a still-active longer-lived rule.
    const pipeline = mockPipeline();
    const slot = nextSlot++;
    const long = rule({ id: 'rlong', slotIndex: slot, camera: 'front_door', labels: ['person'], minSeconds: 50 });
    const short = rule({ id: 'rshort', slotIndex: slot, camera: 'front_door', labels: ['motion'], minSeconds: 20 });
    const config = cfg([long, short]);

    // Person detected: the long rule claims the slot and is still actively watched.
    handleFrigateEvent({ camera: 'front_door', label: 'person', active: true }, config, pipeline);
    // Motion briefly fires and clears on the short rule.
    handleFrigateEvent({ camera: 'front_door', label: 'motion', active: true }, config, pipeline);
    handleFrigateEvent({ camera: 'front_door', label: 'motion', active: false }, config, pipeline);

    // The short rule's 20s timer fires -- must NOT clear the slot, because
    // "long" still has person active on it.
    vi.advanceTimersByTime(20000);
    expect(pipeline.setEventOverride).not.toHaveBeenCalledWith(slot, null);

    // Person finally clears too; "long" still owes the remainder of its own
    // 50s floor (30s left, since 20s already passed above) before reverting.
    handleFrigateEvent({ camera: 'front_door', label: 'person', active: false }, config, pipeline);
    expect(pipeline.setEventOverride).not.toHaveBeenCalledWith(slot, null);
    vi.advanceTimersByTime(30000);
    expect(pipeline.setEventOverride).toHaveBeenLastCalledWith(slot, null);
  });
});

describe('pruneFrigateState', () => {
  it('hands the slot back when an active rule is removed from config', () => {
    const pipeline = mockPipeline();
    const activeRule = rule({ id: 'r9', minSeconds: 100 });
    handleFrigateEvent({ camera: 'front_door', label: 'person', active: true }, cfg([activeRule]), pipeline);
    expect(pipeline.setEventOverride).toHaveBeenCalledTimes(1);

    pruneFrigateState(cfg([]), pipeline);
    expect(pipeline.setEventOverride).toHaveBeenLastCalledWith(activeRule.slotIndex, null);
  });

  it('leaves an unrelated still-configured rule alone', () => {
    const pipeline = mockPipeline();
    const keep = rule({ id: 'r10', minSeconds: 100 });
    handleFrigateEvent({ camera: 'front_door', label: 'person', active: true }, cfg([keep]), pipeline);
    pipeline.setEventOverride.mockClear();

    pruneFrigateState(cfg([keep]), pipeline);
    expect(pipeline.setEventOverride).not.toHaveBeenCalled();
  });

  it('does not clear a slot still legitimately held by another surviving rule', () => {
    const pipeline = mockPipeline();
    const slot = nextSlot++;
    const removed = rule({ id: 'rremoved', slotIndex: slot, labels: ['motion'] });
    const kept = rule({ id: 'rkept', slotIndex: slot, labels: ['person'] });
    handleFrigateEvent({ camera: 'front_door', label: 'motion', active: true }, cfg([removed, kept]), pipeline);
    handleFrigateEvent({ camera: 'front_door', label: 'person', active: true }, cfg([removed, kept]), pipeline);
    pipeline.setEventOverride.mockClear();

    // "removed" is gone from config (e.g. the user deleted it), but "kept" is
    // still active on the same slot -- must not be reverted.
    pruneFrigateState(cfg([kept]), pipeline);
    expect(pipeline.setEventOverride).not.toHaveBeenCalledWith(slot, null);
  });
});
