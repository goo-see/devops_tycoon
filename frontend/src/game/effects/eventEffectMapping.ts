/**
 * POLICY-C-FU-002 — explicit event → effect mapping policy (allowlist).
 *
 * EXACT-MATCH allowlist. Two production mappings:
 *   REQUEST_ROUTED  → effect.network-flow.primary  (source→target edge, sim-time TTL)
 *   INCIDENT_OPENED → effect.incident-alert.primary (target node,   sim-time TTL)
 *
 * There is deliberately NO inference:
 *   - no `effect.${event.type}.primary` name convention,
 *   - no `contains("REQUEST")` / substring matching,
 *   - no category inference,
 *   - no unknown-event fallback effect.
 * An event type not present here maps to NOTHING (no effect), which is correct.
 * INCIDENT_PHASE_CHANGED / INCIDENT_RESOLVED / NODE_* are intentionally NOT mapped.
 */

/**
 * Placement strategy for a mapped effect.
 *  - `source-to-target`: an edge effect between two nodes (network flow).
 *  - `target-node`: a node-centered effect on a single node (incident alert).
 */
export type EffectPlacement = 'source-to-target' | 'target-node';

export interface EventEffectMapping {
  /** Canonical DomainEvent type this mapping is keyed on (exact match). */
  readonly eventType: string;
  /** Production asset id acquired via the AssetManager. */
  readonly assetId: string;
  /** Effect lifetime in SIMULATION TICKS (not wall-clock). See below. */
  readonly durationTicks: number;
  /** How the effect is placed relative to the event's node(s). */
  readonly placement: EffectPlacement;
}

/** The approved production effect resources (FU-002 candidates #005 / #006). */
export const NETWORK_FLOW_EFFECT_ASSET_ID = 'effect.network-flow.primary';
export const INCIDENT_ALERT_EFFECT_ASSET_ID = 'effect.incident-alert.primary';

/**
 * durationTicks = 6 (both mappings).
 *
 * Rationale: the simulation clock is `tick_ms = 200` at 1x (5 ticks/sec). 6 ticks
 * is ≈ 1.2 s at 1x, 0.6 s at 2x, 0.3 s at 4x — long enough for the presentation to
 * register, short enough that consecutive-tick occurrences do not saturate the board.
 * Because expiry is `event.tick + durationTicks` (SIMULATION time), the lifetime is an
 * identical number of ticks at every speed; only wall-clock differs. Never recomputed
 * per speed.
 *
 * The Incident Alert is a TRANSIENT presentation of "an incident just OPENED here"; its
 * visibility is a fixed presentation TTL and is deliberately NOT tied to
 * INCIDENT_RESOLVED — it does not claim the incident stays active while the alert shows.
 * The value is intentionally the same 6 ticks as Network Flow for board consistency.
 */
export const EFFECT_DURATION_TICKS = 6;

export const EVENT_EFFECT_MAPPINGS: readonly EventEffectMapping[] = [
  {
    eventType: 'REQUEST_ROUTED',
    assetId: NETWORK_FLOW_EFFECT_ASSET_ID,
    durationTicks: EFFECT_DURATION_TICKS,
    placement: 'source-to-target',
  },
  {
    eventType: 'INCIDENT_OPENED',
    assetId: INCIDENT_ALERT_EFFECT_ASSET_ID,
    durationTicks: EFFECT_DURATION_TICKS,
    placement: 'target-node',
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
 * Deterministic occurrence identity: `${type}:${tick}:${part}:...`. NEVER a random UUID
 * — the same occurrence observed twice (socket dup / store replay) yields the same key.
 *
 *  - REQUEST_ROUTED : `request-routed:<tick>:<source>:<target>`  (source, target)
 *  - INCIDENT_OPENED: `incident-opened:<tick>:<target>:<incidentType>` (target, incident)
 *
 * The incident identity uses `incident_type + tick + target` — the backend opens at most
 * one incident per (type, target) per tick (book keyed by `type:target`), and DIFFERENT
 * incident types may open on the same target in the same tick, so the type discriminator
 * is required (tick+target alone would incorrectly collapse two distinct incidents).
 */
export function occurrenceKey(eventType: string, tick: number, ...parts: string[]): string {
  const slug = eventType.toLowerCase().replace(/_/g, '-');
  return [slug, String(tick), ...parts].join(':');
}
