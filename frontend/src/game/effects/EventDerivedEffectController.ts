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
import { occurrenceKey, resolveEffectMapping, type EventEffectMapping } from './eventEffectMapping';

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

type Phase = 'PENDING' | 'ACTIVE';

interface EffectInstance {
  readonly key: string;
  phase: Phase;
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
    // §5: use the event's explicit source/target — NEVER infer from topology.
    const source = readNodeId(payload['source_node_id']);
    const target = readNodeId(payload['target_node_id']);
    if (source === null || target === null) return; // malformed payload → no effect

    // Keep the clock at least at this event's tick (events may lead polling).
    if (env.tick > this.currentTick) this.currentTick = env.tick;

    const expiresAtTick = env.tick + mapping.durationTicks;
    if (this.currentTick >= expiresAtTick) return; // late / already-expired event

    const key = occurrenceKey(env.type, env.tick, source, target);
    if (this.registry.has(key)) return; // dedup: already PENDING or ACTIVE

    // Resolve placement BEFORE acquiring; a node we cannot place → skip (no
    // arbitrary board-center spawn).
    if (this.deps.positionOf(source) === undefined) return;
    if (this.deps.positionOf(target) === undefined) return;

    const entry: EffectInstance = {
      key,
      phase: 'PENDING',
      expiresAtTick,
      generation: this.generation,
      handle: null,
      sprite: null,
    };
    this.registry.set(key, entry);
    void this.acquireAndAttach(entry, mapping, source, target);
  }

  private async acquireAndAttach(
    entry: EffectInstance,
    mapping: EventEffectMapping,
    source: string,
    target: string,
  ): Promise<void> {
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

    const sourcePos = this.deps.positionOf(source);
    const targetPos = this.deps.positionOf(target);

    if (stale || sourcePos === undefined || targetPos === undefined || handle.texture === null) {
      handle.release();
      if (this.registry.get(entry.key) === entry) this.registry.delete(entry.key);
      return;
    }

    const sprite = this.deps.createSprite(handle.texture);
    applyEdgeTransform(sprite, sourcePos, targetPos);
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
