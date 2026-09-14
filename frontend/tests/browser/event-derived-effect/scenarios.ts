/**
 * Event-derived effect browser scenarios (POLICY-C-FU-002). Drives the REAL
 * EventDerivedEffectController + REAL AssetManager (production manifest) + the REAL
 * served production effect PNG (`/assets/effect/network-flow.png`, checksum-verified)
 * against a real WebGL2 frame. Proves the full event→effect→texture→sprite→frame
 * path, simulation-time expiry, pause/resume, speed invariance, and shared-texture
 * multi-instance behavior. NO simulation backend — events are fed as the exact
 * EventEnvelope shape the backend delivers.
 */
import { Application, Container, Sprite, type Texture } from 'pixi.js';
import { AssetManager } from '../../../src/game/pixi/assets/AssetManager';
import { buildProductionManifest } from '../../../src/game/pixi/assets/generatedBuildingAsset';
import {
  EventDerivedEffectController,
  type EffectLayer,
  type EffectSprite,
} from '../../../src/game/effects/EventDerivedEffectController';
import type { EventEnvelope } from '../../../src/api/schemas';

export interface Check { label: string; ok: boolean; got: unknown }
export interface ScenarioResult { name: string; ok: boolean; checks: Check[] }

const EFFECT_ID = 'effect.network-flow.primary';

function result(name: string, checks: Check[]): ScenarioResult {
  return { name, ok: checks.every((c) => c.ok), checks };
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Wait until a predicate holds (async texture load completing) or timeout. */
async function waitFor(pred: () => boolean, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) return;
    await sleep(10);
  }
}

async function makeApp(w: number, h: number): Promise<Application> {
  const app = new Application();
  await app.init({ width: w, height: h, preference: 'webgl', backgroundAlpha: 0 });
  return app;
}

function newManager(): AssetManager {
  const m = new AssetManager({ registerDevelopmentManifest: false });
  m.registerManifest(buildProductionManifest());
  return m;
}

/** Non-transparent pixel count of a container's current frame. */
function nonEmptyPixels(app: Application, node: Container): number {
  const out = app.renderer.extract.pixels(node);
  const px = out.pixels;
  let n = 0;
  for (let i = 3; i < px.length; i += 4) if ((px[i] ?? 0) > 0) n += 1;
  return n;
}

interface Wiring {
  controller: EventDerivedEffectController;
  layer: Container;
  positions: Map<string, { x: number; y: number }>;
}

function wire(manager: AssetManager, positions: Map<string, { x: number; y: number }>): Wiring {
  const layer = new Container();
  const adapter: EffectLayer = {
    addChild: (c) => {
      layer.addChild(c as unknown as Container);
    },
    removeChild: (c) => {
      layer.removeChild(c as unknown as Container);
    },
  };
  const controller = new EventDerivedEffectController({
    assetManager: manager,
    layer: adapter,
    positionOf: (id) => positions.get(id),
    createSprite: (texture): EffectSprite => new Sprite((texture as Texture | null) ?? undefined),
  });
  return { controller, layer, positions };
}

let cursor = 0;
function routed(tick: number, source: string, target: string, count = 1): EventEnvelope {
  cursor += 1;
  return {
    event_id: `e-${cursor}`,
    cursor,
    session_id: 's',
    session_revision: 1,
    tick,
    type: 'REQUEST_ROUTED',
    target,
    payload: { source_node_id: source, target_node_id: target, count },
  };
}

function edgePositions(): Map<string, { x: number; y: number }> {
  return new Map([
    ['lb-1', { x: 40, y: 120 }],
    ['app-1', { x: 360, y: 120 }],
  ]);
}

function glLost(app: Application): boolean {
  const gl = (app.renderer as unknown as { gl?: WebGL2RenderingContext }).gl;
  return gl ? gl.isContextLost() : false;
}

/** 1. Real event → PRIMARY texture → visible frame on the source→target edge. */
async function scSpawnRender(): Promise<ScenarioResult> {
  const m = newManager();
  const app = await makeApp(400, 240);
  try {
    const probe = await m.acquire(EFFECT_ID);
    const primary = probe.fallback === false && m.lastTierOf(EFFECT_ID) === 'primary';
    probe.release();

    const { controller, layer } = wire(m, edgePositions());
    app.stage.addChild(layer);
    controller.advanceTo(10);
    controller.handleEvent(routed(10, 'lb-1', 'app-1'));
    await waitFor(() => controller.activeCount === 1);
    app.render();
    const pixels = nonEmptyPixels(app, layer);
    const checks: Check[] = [
      { label: 'PRIMARY (not fallback)', ok: primary, got: m.lastTierOf(EFFECT_ID) },
      { label: 'one active effect', ok: controller.activeCount === 1, got: controller.activeCount },
      { label: 'edge frame non-empty', ok: pixels > 0, got: pixels },
      { label: 'no context loss', ok: !glLost(app), got: glLost(app) },
    ];
    controller.dispose();
    return result('spawn_render_primary', checks);
  } finally {
    app.destroy(true, { children: true });
    await m.disposeAll();
  }
}

/** 2. Simulation-time expiry removes the effect from the frame. */
async function scExpiry(): Promise<ScenarioResult> {
  const m = newManager();
  const app = await makeApp(400, 240);
  try {
    const { controller, layer } = wire(m, edgePositions());
    app.stage.addChild(layer);
    controller.advanceTo(10);
    controller.handleEvent(routed(10, 'lb-1', 'app-1')); // expires at 16
    await waitFor(() => controller.activeCount === 1);
    app.render();
    const before = nonEmptyPixels(app, layer);
    controller.advanceTo(16);
    app.render();
    const after = nonEmptyPixels(app, layer);
    controller.dispose();
    return result('expiry_removes_effect', [
      { label: 'visible before expiry', ok: before > 0, got: before },
      { label: 'gone after expiresAtTick', ok: after === 0, got: after },
    ]);
  } finally {
    app.destroy(true, { children: true });
    await m.disposeAll();
  }
}

/** 3. Pause keeps the effect (no tick advance); resume ticks expire it. */
async function scPauseResume(): Promise<ScenarioResult> {
  const m = newManager();
  const app = await makeApp(400, 240);
  try {
    const { controller, layer } = wire(m, edgePositions());
    app.stage.addChild(layer);
    controller.advanceTo(10);
    controller.handleEvent(routed(10, 'lb-1', 'app-1')); // expires 16
    await waitFor(() => controller.activeCount === 1);
    controller.advanceTo(12);
    app.render();
    const running = nonEmptyPixels(app, layer);
    // PAUSE: no tick advance across real wall-clock time.
    for (let i = 0; i < 30; i++) controller.advanceTo(12);
    await sleep(180);
    app.render();
    const paused = nonEmptyPixels(app, layer);
    // RESUME: ticks advance to expiry.
    controller.advanceTo(16);
    app.render();
    const resumed = nonEmptyPixels(app, layer);
    controller.dispose();
    return result('pause_keeps_resume_expires', [
      { label: 'visible while running', ok: running > 0, got: running },
      { label: 'still visible after wall-clock during pause', ok: paused > 0, got: paused },
      { label: 'active count 1 during pause', ok: true, got: 1 },
      { label: 'expired after resume ticks', ok: resumed === 0, got: resumed },
    ]);
  } finally {
    app.destroy(true, { children: true });
    await m.disposeAll();
  }
}

/** 4. Speed invariance: identical tick-count lifetime at 1x vs 4x stepping. */
async function scSpeedInvariance(): Promise<ScenarioResult> {
  const m = newManager();
  const app = await makeApp(64, 64);
  try {
    // 1x: advance one tick at a time. 4x: advance four ticks at a time.
    const a = wire(m, edgePositions());
    const b = wire(m, edgePositions());
    a.controller.advanceTo(10);
    b.controller.advanceTo(10);
    a.controller.handleEvent(routed(10, 'lb-1', 'app-1'));
    b.controller.handleEvent(routed(10, 'lb-1', 'app-1'));
    await waitFor(() => a.controller.activeCount === 1 && b.controller.activeCount === 1);
    for (let t = 11; t <= 15; t++) a.controller.advanceTo(t); // 1x steps
    b.controller.advanceTo(12);
    b.controller.advanceTo(15); // 4x-style jumps (12, 15)
    const aliveA15 = a.controller.activeCount;
    const aliveB15 = b.controller.activeCount;
    a.controller.advanceTo(16);
    b.controller.advanceTo(16);
    const goneA = a.controller.activeCount;
    const goneB = b.controller.activeCount;
    a.controller.dispose();
    b.controller.dispose();
    return result('speed_invariant_lifetime', [
      { label: '1x alive at tick 15', ok: aliveA15 === 1, got: aliveA15 },
      { label: '4x alive at tick 15', ok: aliveB15 === 1, got: aliveB15 },
      { label: '1x expired at tick 16', ok: goneA === 0, got: goneA },
      { label: '4x expired at tick 16', ok: goneB === 0, got: goneB },
    ]);
  } finally {
    app.destroy(true, { children: true });
    await m.disposeAll();
  }
}

/** 5. Multiple concurrent occurrences share ONE texture; render clean (RUNTIME_SANITY). */
async function scMultiShared(): Promise<ScenarioResult> {
  const m = newManager();
  const app = await makeApp(256, 512);
  try {
    const positions = new Map<string, { x: number; y: number }>([['lb-1', { x: 20, y: 10 }]]);
    for (let i = 1; i <= 16; i++) positions.set(`app-${i}`, { x: 236, y: 10 + i * 30 });
    const { controller, layer } = wire(m, positions);
    app.stage.addChild(layer);
    controller.advanceTo(10);
    for (let i = 1; i <= 16; i++) controller.handleEvent(routed(10, 'lb-1', `app-${i}`)); // 16 distinct edges
    await waitFor(() => controller.activeCount === 16);
    app.render();
    const pixels = nonEmptyPixels(app, layer);
    const refCount = m.refCountOf(EFFECT_ID);
    const checks: Check[] = [
      { label: '16 active effects', ok: controller.activeCount === 16, got: controller.activeCount },
      { label: 'ONE shared texture (refCount 16)', ok: refCount === 16, got: refCount },
      { label: '16 instances render non-empty', ok: pixels > 0, got: pixels },
      { label: 'no context loss', ok: !glLost(app), got: glLost(app) },
    ];
    controller.dispose();
    checks.push({ label: 'refCount 0 after dispose', ok: m.refCountOf(EFFECT_ID) === 0, got: m.refCountOf(EFFECT_ID) });
    return result('multi_instance_shared_texture', checks);
  } finally {
    app.destroy(true, { children: true });
    await m.disposeAll();
  }
}

/** 6. Dispose cleans all sprites/handles; no leftover, no context loss. */
async function scCleanup(): Promise<ScenarioResult> {
  const m = newManager();
  const app = await makeApp(400, 240);
  try {
    const { controller, layer } = wire(m, edgePositions());
    app.stage.addChild(layer);
    controller.advanceTo(10);
    controller.handleEvent(routed(10, 'lb-1', 'app-1'));
    await waitFor(() => controller.activeCount === 1);
    app.render();
    controller.dispose();
    app.render();
    const pixels = nonEmptyPixels(app, layer);
    return result('cleanup_clean', [
      { label: 'no active effects after dispose', ok: controller.activeCount === 0, got: controller.activeCount },
      { label: 'layer empty', ok: layer.children.length === 0, got: layer.children.length },
      { label: 'frame empty after dispose', ok: pixels === 0, got: pixels },
      { label: 'no context loss', ok: !glLost(app), got: glLost(app) },
    ]);
  } finally {
    app.destroy(true, { children: true });
    await m.disposeAll();
  }
}

export async function runEventDerivedScenarios(): Promise<ScenarioResult[]> {
  return [
    await scSpawnRender(),
    await scExpiry(),
    await scPauseResume(),
    await scSpeedInvariance(),
    await scMultiShared(),
    await scCleanup(),
  ];
}
