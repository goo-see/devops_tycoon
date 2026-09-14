import { describe, expect, it } from 'vitest';
import {
  EVENT_EFFECT_MAPPINGS,
  NETWORK_FLOW_EFFECT_ASSET_ID,
  REQUEST_ROUTED_EFFECT_DURATION_TICKS,
  occurrenceKey,
  resolveEffectMapping,
} from '../../../src/game/effects/eventEffectMapping';

describe('eventEffectMapping (POLICY-C-FU-002 allowlist)', () => {
  it('maps REQUEST_ROUTED → effect.network-flow.primary (source→target, sim-time TTL)', () => {
    const m = resolveEffectMapping('REQUEST_ROUTED');
    expect(m).not.toBeNull();
    expect(m?.assetId).toBe(NETWORK_FLOW_EFFECT_ASSET_ID);
    expect(m?.assetId).toBe('effect.network-flow.primary');
    expect(m?.placement).toBe('source-to-target');
    expect(m?.durationTicks).toBe(REQUEST_ROUTED_EFFECT_DURATION_TICKS);
    expect(Number.isInteger(m?.durationTicks)).toBe(true);
    expect((m?.durationTicks ?? 0) > 0).toBe(true);
  });

  it('is a single-entry allowlist (v1)', () => {
    expect(EVENT_EFFECT_MAPPINGS).toHaveLength(1);
    expect(EVENT_EFFECT_MAPPINGS[0]?.eventType).toBe('REQUEST_ROUTED');
  });

  it('returns null for any non-allowlisted event (no inference, no fallback)', () => {
    for (const t of [
      'CACHE_MISS',
      'NODE_DOWN',
      'INCIDENT_OPENED',
      'REQUEST_DROPPED',
      'REQUEST_COMPLETED',
      'REQUEST', // substring must NOT match
      'request_routed', // wrong case must NOT match
      'effect.network-flow.primary',
      '',
    ]) {
      expect(resolveEffectMapping(t)).toBeNull();
    }
  });

  it('produces a deterministic occurrence key (tick+source+target, no UUID)', () => {
    expect(occurrenceKey('REQUEST_ROUTED', 420, 'lb-1', 'app-2')).toBe('request-routed:420:lb-1:app-2');
    // stable across calls
    expect(occurrenceKey('REQUEST_ROUTED', 420, 'lb-1', 'app-2')).toBe(
      occurrenceKey('REQUEST_ROUTED', 420, 'lb-1', 'app-2'),
    );
    // distinct per tick / per edge
    expect(occurrenceKey('REQUEST_ROUTED', 421, 'lb-1', 'app-2')).not.toBe(
      occurrenceKey('REQUEST_ROUTED', 420, 'lb-1', 'app-2'),
    );
    expect(occurrenceKey('REQUEST_ROUTED', 420, 'lb-1', 'app-3')).not.toBe(
      occurrenceKey('REQUEST_ROUTED', 420, 'lb-1', 'app-2'),
    );
  });
});
