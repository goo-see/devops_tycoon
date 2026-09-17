import { describe, expect, it } from 'vitest';
import {
  EVENT_EFFECT_MAPPINGS,
  NETWORK_FLOW_EFFECT_ASSET_ID,
  INCIDENT_ALERT_EFFECT_ASSET_ID,
  EFFECT_DURATION_TICKS,
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
    expect(m?.durationTicks).toBe(EFFECT_DURATION_TICKS);
    expect(Number.isInteger(m?.durationTicks)).toBe(true);
    expect((m?.durationTicks ?? 0) > 0).toBe(true);
  });

  it('maps INCIDENT_OPENED → effect.incident-alert.primary (target-node, sim-time TTL)', () => {
    const m = resolveEffectMapping('INCIDENT_OPENED');
    expect(m).not.toBeNull();
    expect(m?.assetId).toBe(INCIDENT_ALERT_EFFECT_ASSET_ID);
    expect(m?.assetId).toBe('effect.incident-alert.primary');
    expect(m?.placement).toBe('target-node');
    expect(m?.durationTicks).toBe(EFFECT_DURATION_TICKS);
  });

  it('is an exact-match allowlist of exactly the two approved effect mappings (v1)', () => {
    expect(EVENT_EFFECT_MAPPINGS).toHaveLength(2);
    expect(EVENT_EFFECT_MAPPINGS.map((m) => m.eventType).sort()).toEqual([
      'INCIDENT_OPENED',
      'REQUEST_ROUTED',
    ]);
  });

  it('returns null for any non-allowlisted event (no inference, no fallback)', () => {
    for (const t of [
      'CACHE_MISS',
      'NODE_DOWN',
      // other incident events are intentionally NOT mapped to the alert effect
      'INCIDENT_PHASE_CHANGED',
      'INCIDENT_RESOLVED',
      'REQUEST_DROPPED',
      'REQUEST_COMPLETED',
      'REQUEST', // substring must NOT match
      'INCIDENT', // substring must NOT match
      'request_routed', // wrong case must NOT match
      'incident_opened', // wrong case must NOT match
      'effect.network-flow.primary',
      '',
    ]) {
      expect(resolveEffectMapping(t)).toBeNull();
    }
  });

  it('produces a deterministic REQUEST_ROUTED occurrence key (tick+source+target, no UUID)', () => {
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

  it('produces a deterministic INCIDENT_OPENED occurrence key (tick+target+incidentType)', () => {
    expect(occurrenceKey('INCIDENT_OPENED', 88, 'lb-1', 'NO_HEALTHY_SERVER')).toBe(
      'incident-opened:88:lb-1:NO_HEALTHY_SERVER',
    );
    // different incident types on the same target+tick stay distinct (not collapsed)
    expect(occurrenceKey('INCIDENT_OPENED', 88, 'app-1', 'APP_CPU_OVERLOAD')).not.toBe(
      occurrenceKey('INCIDENT_OPENED', 88, 'app-1', 'APP_MEM_SATURATION'),
    );
    // different target / tick stay distinct
    expect(occurrenceKey('INCIDENT_OPENED', 88, 'app-2', 'APP_CPU_OVERLOAD')).not.toBe(
      occurrenceKey('INCIDENT_OPENED', 88, 'app-1', 'APP_CPU_OVERLOAD'),
    );
    expect(occurrenceKey('INCIDENT_OPENED', 89, 'app-1', 'APP_CPU_OVERLOAD')).not.toBe(
      occurrenceKey('INCIDENT_OPENED', 88, 'app-1', 'APP_CPU_OVERLOAD'),
    );
  });
});
