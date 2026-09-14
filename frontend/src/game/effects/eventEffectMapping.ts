/**
 * POLICY-C-FU-002 — explicit event → effect mapping policy (allowlist).
 *
 * The FIRST production mapping is exactly ONE entry:
 *   REQUEST_ROUTED → effect.network-flow.primary (source→target, simulation-time TTL).
 *
 * This is an EXACT-MATCH allowlist. There is deliberately NO inference:
 *   - no `effect.${event.type}.primary` name convention,
 *   - no `contains("REQUEST")` / substring matching,
 *   - no category inference,
 *   - no unknown-event fallback effect.
 * An event type not present here maps to NOTHING (no effect), which is correct.
 */

/** Placement strategy for a mapped effect. v1 supports source→target edge only. */
export type EffectPlacement = 'source-to-target';

export interface EventEffectMapping {
  /** Canonical DomainEvent type this mapping is keyed on (exact match). */
  readonly eventType: string;
  /** Production asset id acquired via the AssetManager. */
  readonly assetId: string;
  /** Effect lifetime in SIMULATION TICKS (not wall-clock). See below. */
  readonly durationTicks: number;
  /** How the effect is placed relative to the event's nodes. */
  readonly placement: EffectPlacement;
}

/** The approved production effect resource (FU-002 candidate #005, resource-only). */
export const NETWORK_FLOW_EFFECT_ASSET_ID = 'effect.network-flow.primary';

/**
 * durationTicks = 6.
 *
 * Rationale: the simulation clock is `tick_ms = 200` at 1x (5 ticks/sec). 6 ticks
 * is ≈ 1.2 s at 1x, 0.6 s at 2x, 0.3 s at 4x — long enough for a routing flow to
 * be perceived, short enough that consecutive-tick occurrences on the same edge do
 * not saturate it. Because expiry is `event.tick + durationTicks` (SIMULATION time),
 * the lifetime is an identical number of ticks at every speed; only the wall-clock
 * duration differs (§17). Never recomputed per speed.
 */
export const REQUEST_ROUTED_EFFECT_DURATION_TICKS = 6;

export const EVENT_EFFECT_MAPPINGS: readonly EventEffectMapping[] = [
  {
    eventType: 'REQUEST_ROUTED',
    assetId: NETWORK_FLOW_EFFECT_ASSET_ID,
    durationTicks: REQUEST_ROUTED_EFFECT_DURATION_TICKS,
    placement: 'source-to-target',
  },
];

const BY_EVENT_TYPE: ReadonlyMap<string, EventEffectMapping> = new Map(
  EVENT_EFFECT_MAPPINGS.map((m) => [m.eventType, m]),
);

/** Exact-match resolution. Returns null for any non-allowlisted event type. */
export function resolveEffectMapping(eventType: string): EventEffectMapping | null {
  return BY_EVENT_TYPE.get(eventType) ?? null;
}

/**
 * Deterministic occurrence identity: `${type}:${tick}:${source}:${target}`.
 * e.g. `request-routed:420:lb-1:app-2`. NEVER a random UUID — the same routing
 * occurrence observed twice (socket dup / store replay) yields the same key.
 */
export function occurrenceKey(
  eventType: string,
  tick: number,
  sourceNodeId: string,
  targetNodeId: string,
): string {
  return `${eventType.toLowerCase().replace(/_/g, '-')}:${tick}:${sourceNodeId}:${targetNodeId}`;
}
