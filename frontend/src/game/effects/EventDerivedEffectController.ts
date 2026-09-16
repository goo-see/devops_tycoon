/**
 * EventDerivedEffectController (POLICY-C-FU-002 EVENT_DERIVED runtime).
 *
 * Consumes canonical DomainEvents (delivered as EventEnvelope), resolves the
 * explicit event→effect mapping, and manages a deterministic, SIMULATION-TIME
 * effect lifecycle: acquire the production texture via the AssetManager, attach a
 * Pixi sprite on the source→target edge, and remove it when the occurrence
 * expires (`event.tick + durationTicks`). It is observation-only: an effect NEVER
 * feeds back into the simulation.
 *
 * Design notes:
 *  - No wall-clock: lifetime is driven purely by the authoritative simulation tick
 *    (`advanceTo`). Pause freezes ticks → effects persist; speed only changes how
 *    fast ticks arrive, never the tick-count lifetime.
 *  - Dependencies are structurally typed (no hard Pixi import) so the whole
 *    lifecycle is unit-testable without a WebGL context; the real scene injects
 *    Pixi Sprite/Container + the AssetManager.
 *  - A generation counter invalidates in-flight async acquires across reset/dispose
 *    so a late-resolving load never resurrects a dead occurrence.
 */

import type { EventEnvelope } from '../../api/schemas';
import {
  occurrenceKey,
  resolveEffectMapping,
  type EventEffectMapping,
  type EffectPlacement,
} from './eventEffectMapping';

/** Minimal texture handle contract (AssetManager.AssetHandle is a structural match). */
export interface EffectAssetHandle {
  readonly texture: unknown;
  readonly fallback: boolean;
  release(): void;
}

export interface EffectAssetSource {
  acquire(assetId: string): Promise<EffectAssetHandle>;
}

/** Minimal sprite contract (Pixi Sprite is a structural match). */
export interface EffectSprite {
  anchor: { set(x: number, y: number): void };
  position: { set(x: number, y: number): void };
  rotation: number;
  width: number;
  height: number;
  destroy(options?: { texture?: boolean; textureSource?: boolean; children?: boolean }): void;
}

/** Minimal layer contract (Pixi Container is a structural match). */
export interface EffectLayer {
  addChild(child: EffectSprite): void;
  removeChild(child: EffectSprite): void;
}

export interface Point {
  x: number;
  y: number;
}

export interface EventDerivedEffectControllerDeps {
  assetManager: EffectAssetSource;
  layer: EffectLayer;
  /** Resolve a node's world-space position; undefined if the node is unknown. */
  positionOf: (nodeId: string) => Point | undefined;
  /** Factory for the effect sprite (defaults injected by the scene). */
  createSprite: (texture: unknown) => EffectSprite;
}

// --- placement constants (single source of truth; §25) --------------------- //
// The production network-flow texture is a 1024×256 horizontal directional beam.
// anchor (0.5,0.5) centers it on the edge midpoint; rotation aligns local +x
// (the beam's flow direction) with source→target; width = edge length; height =
// a fixed readable band. All magic numbers live here, nowhere else.
const EFFECT_ANCHOR_X = 0.5;
const EFFECT_ANCHOR_Y = 0.5;
const EFFECT_THICKNESS_PX = 22;
const EFFECT_MIN_LENGTH_PX = 8;
// Incident alert (target-node) placement: the 512×512 radial alert is centered on the
// affected node, rendered at a fixed readable board size, raised slightly so it reads as
// sitting over the building. No rotation (radial, non-directional). Single source of truth.
const INCIDENT_SIZE_PX = 96;
const INCIDENT_Y_OFFSET_PX = -6;

type Phase = 'PENDING' | 'ACTIVE';

interface EffectInstance {
  readonly key: string;
  phase: Phase;
  readonly placement: EffectPlacement;
  /** Edge source node (source-to-target only); null for target-node placement. */
  readonly source: string | null;
  /** The node the effect is placed on/at (edge target, or the single alert node). */
  readonly target: string;
  readonly expiresAtTick: number;
  readonly generation: number;
  handle: EffectAssetHandle | null;
  sprite: EffectSprite | null;
}

function readNodeId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function applyEdgeTransform(sprite: EffectSprite, source: Point, target: Point): void {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.hypot(dx, dy);
  sprite.anchor.set(EFFECT_ANCHOR_X, EFFECT_ANCHOR_Y);
  sprite.width = Math.max(distance, EFFECT_MIN_LENGTH_PX);
  sprite.height = EFFECT_THICKNESS_PX;
  sprite.position.set((source.x + target.x) / 2, (source.y + target.y) / 2);
  sprite.rotation = Math.atan2(dy, dx); // source → target direction
}

/** Node-centered transform for a target-node effect (incident alert). Deterministic:
 * fixed square size, centered anchor, fixed vertical offset, no rotation. */
function applyNodeTransform(sprite: EffectSprite, at: Point): void {
  sprite.anchor.set(EFFECT_ANCHOR_X, EFFECT_ANCHOR_Y);
  sprite.width = INCIDENT_SIZE_PX;
  sprite.height = INCIDENT_SIZE_PX;
  sprite.rotation = 0;
  sprite.position.set(at.x, at.y + INCIDENT_Y_OFFSET_PX);
}

export class EventDerivedEffectController {
  private readonly deps: EventDerivedEffectControllerDeps;
  private readonly registry = new Map<string, EffectInstance>();
  private currentTick = 0;
  private generation = 0;
  private disposed = false;

  constructor(deps: EventDerivedEffectControllerDeps) {
    this.deps = deps;
  }

  /**
   * Advance the authoritative simulation clock and expire any ACTIVE effect whose
   * `expiresAtTick` has been reached. Monotonic: never moves backwards.
   */
  advanceTo(tick: number): void {
    if (this.disposed) return;
    if (Number.isInteger(tick) && tick > this.currentTick) this.currentTick = tick;
    this.expireDue();
  }

  /** Process one delivered DomainEvent envelope. Idempotent per occurrence. */
  handleEvent(env: EventEnvelope): void {
    if (this.disposed) return;
    const mapping = resolveEffectMapping(env.type);
    if (mapping === null) return; // unknown / non-mapped event → no effect

    if (!Number.isInteger(env.tick)) return;
    const payload = env.payload ?? {};

    // Resolve occurrence identity + placement nodes per the mapping's strategy. §5: read
    // the event's explicit fields — NEVER infer endpoints from topology.
    let source: string | null;
    let target: string;
    let key: string;
    if (mapping.placement === 'source-to-target') {
      const s = readNodeId(payload['source_node_id']);
      const t = readNodeId(payload['target_node_id']);
      if (s === null || t === null) return; // malformed payload → no effect
      source = s;
      target = t;
      key = occurrenceKey(env.type, env.tick, s, t);
    } else {
      // target-node: the affected node is the envelope target; the incident type
      // discriminates identity so distinct incidents on the same node/tick stay separate.
      const t = readNodeId(env.target) ?? readNodeId(payload['target_node_id']);
      const kind = readNodeId(payload['incident']);
      if (t === null || kind === null) return; // malformed payload → no effect
      source = null;
      target = t;
      key = occurrenceKey(env.type, env.tick, t, kind);
    }

    // Keep the clock at least at this event's tick (events may lead polling).
    if (env.tick > this.currentTick) this.currentTick = env.tick;

    const expiresAtTick = env.tick + mapping.durationTicks;
    if (this.currentTick >= expiresAtTick) return; // late / already-expired event

    if (this.registry.has(key)) return; // dedup: already PENDING or ACTIVE

    // Resolve placement BEFORE acquiring; any node we must place but cannot → skip (no
    // arbitrary board-center spawn).
    if (source !== null && this.deps.positionOf(source) === undefined) return;
    if (this.deps.positionOf(target) === undefined) return;

    const entry: EffectInstance = {
      key,
      phase: 'PENDING',
      placement: mapping.placement,
      source,
      target,
      expiresAtTick,
      generation: this.generation,
      handle: null,
      sprite: null,
    };
    this.registry.set(key, entry);
    void this.acquireAndAttach(entry, mapping);
  }

  private async acquireAndAttach(entry: EffectInstance, mapping: EventEffectMapping): Promise<void> {
    let handle: EffectAssetHandle;
    try {
      handle = await this.deps.assetManager.acquire(mapping.assetId);
    } catch {
      // Load failure: rely on the AssetManager fallback contract; keep the
      // registry clean and the renderer healthy (no effect-specific fallback).
      if (this.registry.get(entry.key) === entry) this.registry.delete(entry.key);
      return;
    }

    // Race guards (§30/§31/§32): disposed, superseded generation, replaced entry,
    // no longer pending, or expired while the load was in flight.
    const stale =
      this.disposed ||
      entry.generation !== this.generation ||
      this.registry.get(entry.key) !== entry ||
      entry.phase !== 'PENDING' ||
      this.currentTick >= entry.expiresAtTick;

    const targetPos = this.deps.positionOf(entry.target);
    const sourcePos = entry.source !== null ? this.deps.positionOf(entry.source) : undefined;
    const missingPos = targetPos === undefined || (entry.source !== null && sourcePos === undefined);

    if (stale || missingPos || handle.texture === null) {
      handle.release();
      if (this.registry.get(entry.key) === entry) this.registry.delete(entry.key);
      return;
    }

    const sprite = this.deps.createSprite(handle.texture);
    // targetPos is narrowed to Point by the missingPos guard above; for the edge case
    // sourcePos is defined too (source !== null ⇒ missingPos caught an undefined position).
    if (entry.placement === 'source-to-target') {
      applyEdgeTransform(sprite, sourcePos as Point, targetPos);
    } else {
      applyNodeTransform(sprite, targetPos);
    }
    this.deps.layer.addChild(sprite);
    entry.handle = handle;
    entry.sprite = sprite;
    entry.phase = 'ACTIVE';
  }

  private expireDue(): void {
    for (const entry of [...this.registry.values()]) {
      if (entry.phase === 'ACTIVE' && this.currentTick >= entry.expiresAtTick) {
        this.removeInstance(entry);
      }
    }
  }

  /** Idempotently detach + release one instance. Never destroys the shared texture. */
  private removeInstance(entry: EffectInstance): void {
    if (entry.sprite !== null) {
      this.deps.layer.removeChild(entry.sprite);
      entry.sprite.destroy({ texture: false, textureSource: false, children: true });
      entry.sprite = null;
    }
    if (entry.handle !== null) {
      entry.handle.release();
      entry.handle = null;
    }
    this.registry.delete(entry.key);
  }

  /** Clear all effects and invalidate pending acquires (session reset). */
  reset(): void {
    this.generation += 1; // invalidate in-flight acquires
    for (const entry of [...this.registry.values()]) {
      if (entry.sprite !== null) {
        this.deps.layer.removeChild(entry.sprite);
        entry.sprite.destroy({ texture: false, textureSource: false, children: true });
      }
      if (entry.handle !== null) entry.handle.release();
    }
    this.registry.clear();
    this.currentTick = 0;
  }

  /** Permanent teardown (controller/session dispose). */
  dispose(): void {
    if (this.disposed) return;
    this.reset();
    this.disposed = true;
  }

  // -- introspection (tests / diagnostics only) ----------------------------- //
  get activeCount(): number {
    let n = 0;
    for (const e of this.registry.values()) if (e.phase === 'ACTIVE') n += 1;
    return n;
  }

  get pendingCount(): number {
    let n = 0;
    for (const e of this.registry.values()) if (e.phase === 'PENDING') n += 1;
    return n;
  }

  get size(): number {
    return this.registry.size;
  }

  get tick(): number {
    return this.currentTick;
  }

  hasOccurrence(key: string): boolean {
    return this.registry.has(key);
  }
}
