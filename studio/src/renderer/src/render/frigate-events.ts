/**
 * Reacts to `frigate/<camera>/<label>` MQTT messages (see main/mqtt.ts) by
 * popping the triggering camera onto its configured slot for at least
 * `minSeconds`, and handing the slot back once the object is gone AND that
 * floor has elapsed -- "at least as long as the event is active" from the
 * user's side means the later of (event end, minSeconds).
 *
 * State lives here rather than in the Pinia store because it is a small
 * per-rule state machine (which labels are currently on, when the floor
 * expires) that has nothing to do with the persisted config and would just
 * be noise in studio.ts.
 */
import type { AppConfig, FrigateEvent, FrigateEventRule } from '@shared/types';

import type { Pipeline } from './pipeline';

interface RuleState {
  /** Labels currently "ON" for this rule's camera. */
  activeLabels: Set<string>;
  activatedAt: number;
  revertTimer: ReturnType<typeof setTimeout> | null;
  /**
   * Slot this rule's override currently occupies, or null when idle. Kept
   * here rather than re-read from the rule so cleanup still works after the
   * rule itself has been edited or deleted out from under an active override.
   */
  overrideSlot: number | null;
}

const states = new Map<string, RuleState>();

function stateFor(ruleId: string): RuleState {
  let state = states.get(ruleId);
  if (!state) {
    state = { activeLabels: new Set(), activatedAt: 0, revertTimer: null, overrideSlot: null };
    states.set(ruleId, state);
  }
  return state;
}

/** HH:MM:SS.mmm so log lines can be correlated precisely without relying on DevTools' own (often hidden) timestamp column. */
function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

function clearTimer(state: RuleState): void {
  if (state.revertTimer !== null) {
    clearTimeout(state.revertTimer);
    state.revertTimer = null;
  }
}

function matches(rule: FrigateEventRule, event: FrigateEvent): boolean {
  if (!rule.enabled) return false;
  if (rule.camera !== event.camera) return false;
  return rule.labels.length === 0 || rule.labels.includes(event.label);
}

export function handleFrigateEvent(event: FrigateEvent, config: AppConfig, pipeline: Pipeline): void {
  for (const rule of config.frigateRules) {
    if (!matches(rule, event)) continue;
    const state = stateFor(rule.id);

    if (event.active) {
      const wasIdle = state.activeLabels.size === 0;
      state.activeLabels.add(event.label);
      clearTimer(state);
      if (wasIdle) {
        state.activatedAt = Date.now();
        const server = config.servers.find((s) => s.id === rule.serverId);
        if (server) {
          console.log(`[frigate ${ts()}] "${rule.name || rule.id}" activating slot ${rule.slotIndex} (${rule.camera}/${event.label})`);
          state.overrideSlot = rule.slotIndex;
          void pipeline.setEventOverride(rule.slotIndex, {
            kind: 'stream',
            serverId: rule.serverId,
            camera: rule.camera,
            streamMode: rule.streamMode,
            fit: 'cover',
          });
        }
      }
      continue;
    }

    state.activeLabels.delete(event.label);
    if (state.activeLabels.size > 0 || state.overrideSlot === null) continue;

    const remaining = rule.minSeconds * 1000 - (Date.now() - state.activatedAt);
    console.log(
      `[frigate ${ts()}] "${rule.name || rule.id}" idle, reverting slot ${state.overrideSlot} in ${Math.max(0, Math.round(remaining / 1000))}s`,
    );
    const revert = (): void => {
      state.revertTimer = null;
      const slot = state.overrideSlot;
      if (state.activeLabels.size !== 0 || slot === null) {
        console.log(`[frigate ${ts()}] "${rule.name || rule.id}" revert skipped -- re-triggered before it fired`);
        return;
      }
      // A different rule may be targeting the same slot and still have it
      // legitimately active (e.g. two rules on the same camera with
      // different labels) -- do not yank the slot out from under it just
      // because *this* rule's own hold on it has ended.
      for (const other of states.values()) {
        if (other !== state && other.overrideSlot === slot && other.activeLabels.size > 0) {
          console.log(`[frigate ${ts()}] "${rule.name || rule.id}" revert skipped -- another rule still holds slot ${slot}`);
          state.overrideSlot = null;
          return;
        }
      }
      console.log(`[frigate ${ts()}] "${rule.name || rule.id}" REVERTING slot ${slot} now`);
      void pipeline.setEventOverride(slot, null);
      state.overrideSlot = null;
    };
    if (remaining <= 0) revert();
    else state.revertTimer = setTimeout(revert, remaining);
  }
}

/**
 * Call after every config change. Drops state for rules that no longer
 * exist or are disabled, and hands back any slot they still had claimed --
 * otherwise deleting a rule mid-event would leave its panel stuck forever.
 */
export function pruneFrigateState(config: AppConfig, pipeline: Pipeline): void {
  const live = new Set(config.frigateRules.filter((r) => r.enabled).map((r) => r.id));
  for (const [ruleId, state] of states) {
    if (live.has(ruleId)) continue;
    clearTimer(state);
    const slot = state.overrideSlot;
    state.overrideSlot = null;
    states.delete(ruleId);
    if (slot === null) continue;
    // Same guard as the timed revert: another rule may still legitimately
    // hold this slot active.
    const stillHeld = [...states.values()].some((s) => s.overrideSlot === slot && s.activeLabels.size > 0);
    if (!stillHeld) void pipeline.setEventOverride(slot, null);
  }
}
