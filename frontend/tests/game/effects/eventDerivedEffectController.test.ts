import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EventDerivedEffectController,
  type EffectAssetHandle,
  type EffectLayer,
  type EffectSprite,
  type Point,
} from '../../../src/game/effects/EventDerivedEffectController';
import { occurrenceKey } from '../../../src/game/effects/eventEffectMapping';
import type { EventEnvelope } from '../../../src/api/schemas';

// ------------------------------------------------------------------ helpers //

interface FakeSprite extends EffectSprite {
  x: number;
  y: number;
  destroyed: boolean;
  destroyOpts: { texture?: boolean; textureSource?: boolean; children?: boolean } | undefined;
}

function makeSprite(): FakeSprite {
  const s: FakeSprite = {
    x: 0,
    y: 0,
    rotation: 0,
    width: 0,
    height: 0,
    destroyed: false,
    destroyOpts: undefined,
    anchor: { set: vi.fn() },
    position: {
      set: (x: number, y: number) => {
        s.x = x;
        s.y = y;
      },
    },
    destroy: (opts) => {
      s.destroyed = true;
      s.destroyOpts = opts;
    },
  };
  return s;
}

interface FakeHandle extends EffectAssetHandle {
  released: boolean;
}

function makeHandle(texture: unknown = { id: 'tex' }, fallback = false): FakeHandle {
  const h: FakeHandle = {
    texture,
    fallback,
    released: false,
    release: () => {
      h.released = true;
    },
  };
  return h;
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let cursorSeq = 0;
function routedEvent(
  tick: number,
  source: string,
  target: string,
  count = 1,
  overrides: Partial<EventEnvelope> = {},
): EventEnvelope {
  cursorSeq += 1;
  return {
    event_id: `evt-${cursorSeq}`,
    cursor: cursorSeq,
    session_id: 'sess-1',
    session_revision: 1,
    tick,
    type: 'REQUEST_ROUTED',
    target,
    payload: { source_node_id: source, target_node_id: target, count },
    ...overrides,
  };
}

interface Harness {
  controller: EventDerivedEffectController;
  layer: EffectLayer & { children: FakeSprite[] };
  sprites: FakeSprite[];
  handles: FakeHandle[];
  acquire: ReturnType<typeof vi.fn>;
  positions: Map<string, Point>;
}

function harness(opts: { acquire?: (assetId: string) => Promise<EffectAssetHandle> } = {}): Harness {
  const children: FakeSprite[] = [];
  const sprites: FakeSprite[] = [];
  const handles: FakeHandle[] = [];
  const positions = new Map<string, Point>([
    ['lb-1', { x: 0, y: 0 }],
    ['app-1', { x: 100, y: 0 }],
    ['app-2', { x: 0, y: 100 }],
    ['app-3', { x: 100, y: 100 }],
  ]);
  const layer: EffectLayer & { children: FakeSprite[] } = {
    children,
    addChild: (c) => {
      children.push(c as FakeSprite);
    },
    removeChild: (c) => {
      const i = children.indexOf(c as FakeSprite);
      if (i >= 0) children.splice(i, 1);
    },
  };
  const defaultAcquire = vi.fn(async (_assetId: string): Promise<EffectAssetHandle> => {
    const h = makeHandle();
    handles.push(h);
    return h;
  });
  const acquire = opts.acquire ? vi.fn(opts.acquire) : defaultAcquire;
  const controller = new EventDerivedEffectController({
    assetManager: { acquire: (id) => acquire(id) },
    layer,
    positionOf: (id) => positions.get(id),
    createSprite: (_texture) => {
      const s = makeSprite();
      sprites.push(s);
      return s;
    },
  });
  return { controller, layer, sprites, handles, acquire, positions };
}

// -------------------------------------------------------------------- tests //

describe('EventDerivedEffectController', () => {
  beforeEach(() => {
    cursorSeq = 0;
  });

  it('spawns a network-flow effect for REQUEST_ROUTED (acquire + sprite ACTIVE)', async () => {
    const h = harness();
    h.controller.handleEvent(routedEvent(10, 'lb-1', 'app-1'));
    await flush();
    expect(h.acquire).toHaveBeenCalledTimes(1);
    expect(h.acquire).toHaveBeenCalledWith('effect.network-flow.primary');
    expect(h.controller.activeCount).toBe(1);
    expect(h.layer.children).toHaveLength(1);
  });

  it('ignores unknown / non-mapped events (no acquire, no sprite)', async () => {
    const h = harness();
    h.controller.handleEvent(routedEvent(10, 'lb-1', 'app-1', 1, { type: 'CACHE_MISS' }));
    h.controller.handleEvent(routedEvent(10, 'lb-1', 'app-1', 1, { type: 'REQUEST_COMPLETED' }));
    await flush();
    expect(h.acquire).not.toHaveBeenCalled();
    expect(h.controller.size).toBe(0);
    expect(h.layer.children).toHaveLength(0);
  });

  it('uses payload source/target (never env.target inference) and target mirrors', async () => {
    const h = harness();
    // env.target deliberately WRONG; payload is authoritative.
    h.controller.handleEvent(
      routedEvent(10, 'lb-1', 'app-2', 1, { target: 'app-1' }),
    );
    await flush();
    // occurrence keyed by payload target app-2, not env.target app-1
    expect(h.controller.hasOccurrence(occurrenceKey('REQUEST_ROUTED', 10, 'lb-1', 'app-2'))).toBe(true);
    // in the normal contract env.target === payload.target_node_id
    const normal = routedEvent(11, 'lb-1', 'app-1');
    expect(normal.target).toBe(normal.payload['target_node_id']);
  });

  it('dedups the SAME occurrence (tick+source+target) — one effect, one acquire', async () => {
    const h = harness();
    const e = routedEvent(10, 'lb-1', 'app-1');
    h.controller.handleEvent(e);
    h.controller.handleEvent({ ...e, event_id: 'dup', cursor: 999 }); // socket/replay dup
    await flush();
    expect(h.acquire).toHaveBeenCalledTimes(1);
    expect(h.controller.activeCount).toBe(1);
    expect(h.layer.children).toHaveLength(1);
  });

  it('treats different ticks and different edges as independent occurrences', async () => {
    const h = harness();
    h.controller.handleEvent(routedEvent(10, 'lb-1', 'app-1'));
    h.controller.handleEvent(routedEvent(11, 'lb-1', 'app-1')); // different tick
    h.controller.handleEvent(routedEvent(10, 'lb-1', 'app-2')); // different edge
    await flush();
    expect(h.acquire).toHaveBeenCalledTimes(3);
    expect(h.controller.activeCount).toBe(3);
  });

  it('count is NOT used for visual intensity (count 1 vs 10000 → identical single sprite)', async () => {
    const h = harness();
    h.controller.handleEvent(routedEvent(10, 'lb-1', 'app-1', 1));
    h.controller.handleEvent(routedEvent(11, 'lb-1', 'app-1', 10_000));
    await flush();
    expect(h.controller.activeCount).toBe(2);
    const [a, b] = h.sprites;
    expect(a?.width).toBe(b?.width); // same length (edge geometry only)
    expect(a?.height).toBe(b?.height);
  });

  it('places the effect deterministically on the source→target edge', async () => {
    const h = harness();
    h.controller.handleEvent(routedEvent(10, 'lb-1', 'app-1')); // (0,0)→(100,0)
    await flush();
    const s = h.sprites[0]!;
    expect(s.x).toBe(50); // midpoint x
    expect(s.y).toBe(0); // midpoint y
    expect(s.rotation).toBeCloseTo(0); // horizontal edge
    expect(s.width).toBeCloseTo(100); // edge length
    // vertical edge → rotation π/2
    h.controller.handleEvent(routedEvent(11, 'lb-1', 'app-2')); // (0,0)→(0,100)
    await flush();
    const v = h.sprites[1]!;
    expect(v.rotation).toBeCloseTo(Math.PI / 2);
  });

  it('expires exactly at event.tick + durationTicks (deterministic simulation-time)', async () => {
    const h = harness();
    h.controller.handleEvent(routedEvent(10, 'lb-1', 'app-1')); // expires at 16 (dur=6)
    await flush();
    h.controller.advanceTo(15);
    expect(h.controller.activeCount).toBe(1); // still alive at 15
    h.controller.advanceTo(16);
    expect(h.controller.activeCount).toBe(0); // gone at 16
    expect(h.sprites[0]!.destroyed).toBe(true);
    expect(h.handles[0]!.released).toBe(true);
  });

  it('does NOT spawn a late/already-expired event', async () => {
    const h = harness();
    h.controller.advanceTo(100); // clock already far ahead
    h.controller.handleEvent(routedEvent(10, 'lb-1', 'app-1')); // expired long ago
    await flush();
    expect(h.acquire).not.toHaveBeenCalled();
    expect(h.controller.size).toBe(0);
  });

  it('skips malformed payloads (missing source / target / unknown node)', async () => {
    const h = harness();
    h.controller.handleEvent(routedEvent(10, 'lb-1', 'app-1', 1, { payload: { target_node_id: 'app-1' } }));
    h.controller.handleEvent(routedEvent(10, 'lb-1', 'app-1', 1, { payload: { source_node_id: 'lb-1' } }));
    h.controller.handleEvent(routedEvent(10, 'lb-1', 'app-1', 1, { payload: { source_node_id: 42, target_node_id: 'app-1' } }));
    h.controller.handleEvent(routedEvent(10, 'ghost', 'app-1')); // unknown source → no position
    h.controller.handleEvent(routedEvent(10, 'lb-1', 'ghost')); // unknown target → no position
    await flush();
    expect(h.acquire).not.toHaveBeenCalled();
    expect(h.controller.size).toBe(0);
  });

  it('pause freezes lifetime; only advancing ticks consumes it', async () => {
    const h = harness();
    h.controller.handleEvent(routedEvent(10, 'lb-1', 'app-1')); // expires at 16
    await flush();
    h.controller.advanceTo(12);
    // "pause": no tick advance across many wall-clock frames
    for (let i = 0; i < 100; i++) h.controller.advanceTo(12);
    expect(h.controller.activeCount).toBe(1);
    // resume: ticks advance to expiry
    h.controller.advanceTo(16);
    expect(h.controller.activeCount).toBe(0);
  });

  it('cleanup is idempotent and never destroys the shared texture', async () => {
    const h = harness();
    h.controller.handleEvent(routedEvent(10, 'lb-1', 'app-1'));
    await flush();
    h.controller.advanceTo(16);
    h.controller.advanceTo(17); // second pass over expiry — no throw, no double work
    const s = h.sprites[0]!;
    expect(s.destroyed).toBe(true);
    expect(s.destroyOpts).toEqual({ texture: false, textureSource: false, children: true });
  });

  it('individual removal releases only that handle; others survive', async () => {
    const h = harness();
    h.controller.handleEvent(routedEvent(10, 'lb-1', 'app-1')); // expires 16
    h.controller.handleEvent(routedEvent(14, 'lb-1', 'app-2')); // expires 20
    await flush();
    h.controller.advanceTo(16); // A expires, B survives
    expect(h.handles[0]!.released).toBe(true);
    expect(h.handles[1]!.released).toBe(false);
    expect(h.controller.activeCount).toBe(1);
  });

  it('reset() clears all effects and releases all handles', async () => {
    const h = harness();
    h.controller.handleEvent(routedEvent(10, 'lb-1', 'app-1'));
    h.controller.handleEvent(routedEvent(10, 'lb-1', 'app-2'));
    await flush();
    h.controller.reset();
    expect(h.controller.size).toBe(0);
    expect(h.handles.every((x) => x.released)).toBe(true);
    expect(h.layer.children).toHaveLength(0);
  });

  it('dispose() clears and then ignores further events', async () => {
    const h = harness();
    h.controller.handleEvent(routedEvent(10, 'lb-1', 'app-1'));
    await flush();
    h.controller.dispose();
    expect(h.handles[0]!.released).toBe(true);
    h.controller.handleEvent(routedEvent(20, 'lb-1', 'app-1'));
    await flush();
    expect(h.controller.size).toBe(0);
    expect(h.acquire).toHaveBeenCalledTimes(1); // no acquire after dispose
  });

  it('pending acquire that expires mid-flight never attaches (release, clean)', async () => {
    const d = deferred<EffectAssetHandle>();
    const handle = makeHandle();
    const h = harness({ acquire: () => d.promise });
    h.controller.handleEvent(routedEvent(10, 'lb-1', 'app-1')); // expires 16, PENDING
    expect(h.controller.pendingCount).toBe(1);
    h.controller.advanceTo(16); // expired while load in flight
    d.resolve(handle);
    await flush();
    expect(handle.released).toBe(true);
    expect(h.layer.children).toHaveLength(0);
    expect(h.controller.size).toBe(0);
  });

  it('pending acquire resolving after reset() never resurrects', async () => {
    const d = deferred<EffectAssetHandle>();
    const handle = makeHandle();
    const h = harness({ acquire: () => d.promise });
    h.controller.handleEvent(routedEvent(10, 'lb-1', 'app-1'));
    expect(h.controller.pendingCount).toBe(1);
    h.controller.reset();
    d.resolve(handle);
    await flush();
    expect(handle.released).toBe(true);
    expect(h.controller.size).toBe(0);
    expect(h.layer.children).toHaveLength(0);
  });

  it('pending acquire resolving after dispose() never resurrects', async () => {
    const d = deferred<EffectAssetHandle>();
    const handle = makeHandle();
    const h = harness({ acquire: () => d.promise });
    h.controller.handleEvent(routedEvent(10, 'lb-1', 'app-1'));
    h.controller.dispose();
    d.resolve(handle);
    await flush();
    expect(handle.released).toBe(true);
    expect(h.controller.size).toBe(0);
    expect(h.layer.children).toHaveLength(0);
  });

  it('overlapping same-edge occurrences both live (different ticks)', async () => {
    const h = harness();
    h.controller.handleEvent(routedEvent(10, 'lb-1', 'app-1')); // expires 16
    h.controller.handleEvent(routedEvent(11, 'lb-1', 'app-1')); // expires 17
    await flush();
    h.controller.advanceTo(14);
    expect(h.controller.activeCount).toBe(2); // both alive & overlapping
  });

  it('asset load failure keeps the registry clean (no sprite, no throw)', async () => {
    const h = harness({ acquire: () => Promise.reject(new Error('load failed')) });
    h.controller.handleEvent(routedEvent(10, 'lb-1', 'app-1'));
    await flush();
    expect(h.controller.size).toBe(0);
    expect(h.layer.children).toHaveLength(0);
  });

  it('is deterministic for identical event streams (A == B)', async () => {
    async function run(): Promise<string[]> {
      const h = harness();
      for (const [t, s, tg] of [
        [10, 'lb-1', 'app-1'],
        [10, 'lb-1', 'app-2'],
        [11, 'lb-1', 'app-1'],
      ] as const) {
        h.controller.handleEvent(routedEvent(t, s, tg));
      }
      await flush();
      return h.sprites.map((sp) => `${sp.x},${sp.y},${sp.rotation.toFixed(4)},${sp.width}`);
    }
    expect(await run()).toEqual(await run());
  });
});
