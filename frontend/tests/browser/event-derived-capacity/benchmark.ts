/**
 * EVENT_DERIVED_RUNTIME_CAPACITY_BASELINE — in-page benchmark core.
 *
 * Measures the runtime cost of event-derived effects using the REAL production runtime:
 * the real `EventDerivedEffectController`, the real `AssetManager` +
 * `ProductionImageAssetLoader`, the REAL served production textures
 * (`effect.network-flow.primary`, `effect.incident-alert.primary`), and a real Pixi
 * WebGL2 renderer. ONLY event generation + synthetic node/edge positions are test-owned.
 *
 * No product code is modified and no production debug hook is added: every metric here is
 * obtained through the controller's existing public surface (handleEvent / advanceTo /
 * activeCount / reset) and the AssetManager's existing inspection API (refCountOf), or
 * through browser-standard APIs (rAF, performance.memory, PerformanceObserver).
 *
 * This measures CONTROLLED effect rendering cost — NOT backend/WebSocket/simulation
 * throughput. No performance target is defined; results are MEASURED / OBSERVED facts.
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

const NETWORK_ID = 'effect.network-flow.primary';
const INCIDENT_ID = 'effect.incident-alert.primary';
const DURATION_TICKS = 6; // matches the production mapping; NEVER changed here
const SPAWN_TICK = 1000;

export type Scenario =
  | 'network_only_distributed'
  | 'incident_only_distributed'
  | 'mixed_distributed'
  | 'incident_overlap';

export interface PointConfig {
  scenario: Scenario;
  count: number;
  repeat: number;
  warmupFrames: number;
  measureFrames: number;
}

export interface PointResult {
  scenario: Scenario;
  count: number;
  repeat: number;
  status: 'MEASURED_STABLE' | 'MEASURED_DEGRADED' | 'RUNTIME_UNSTABLE_OBSERVED' | 'MEASUREMENT_INVALID';
  frames: {
    observed: number;
    elapsedMs: number;
    intervalP50: number;
    intervalP95: number;
    intervalP99: number;
    intervalMax: number;
    observedFps: number;
  };
  renderSubmitMs: { p50: number; p95: number; max: number }; // CPU-side app.render() cost, NOT GPU time
  controllerAdvanceMs: { p50: number; p95: number; max: number }; // advanceTo() steady update cost
  spawnBurst: { feedMs: number; framesToAllActive: number; allActive: boolean };
  cleanupBurst: { framesToAllRemoved: number; allRemoved: boolean; refcountsZeroed: boolean };
  textures: { networkRef: number; incidentRef: number; uniqueTextureSources: number };
  heap: { steadyUsedBytes: number | null };
  correctness: { activeCount: number; spriteCount: number; contextLost: boolean; glError: number };
}

// ---- stats ---------------------------------------------------------------- //

function pct(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
  return sortedAsc[idx] ?? 0;
}
function summarize(values: number[]): { p50: number; p95: number; p99: number; max: number } {
  const s = [...values].sort((a, b) => a - b);
  return { p50: pct(s, 50), p95: pct(s, 95), p99: pct(s, 99), max: s.length ? (s[s.length - 1] ?? 0) : 0 };
}

// ---- environment ---------------------------------------------------------- //

export interface EnvInfo {
  webgl2: boolean;
  renderer: string;
  vendor: string;
  maxTextureSize: number | null;
  gpuTimerQuery: 'AVAILABLE' | 'NOT_AVAILABLE';
  preciseMemory: boolean;
  hardwareConcurrency: number;
  deviceMemory: number | null;
  devicePixelRatio: number;
  viewport: { width: number; height: number };
}

export function collectEnv(): EnvInfo {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  let renderer = 'unknown';
  let vendor = 'unknown';
  let maxTex: number | null = null;
  let timer: 'AVAILABLE' | 'NOT_AVAILABLE' = 'NOT_AVAILABLE';
  if (gl) {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) {
      renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));
      vendor = String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL));
    }
    maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (gl.getExtension('EXT_disjoint_timer_query_webgl2')) timer = 'AVAILABLE';
  }
  const perfMem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return {
    webgl2: gl !== null,
    renderer,
    vendor,
    maxTextureSize: maxTex,
    gpuTimerQuery: timer,
    preciseMemory: perfMem !== undefined,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null,
    devicePixelRatio: window.devicePixelRatio,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
}

function heapUsed(): number | null {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return m ? m.usedJSHeapSize : null;
}
function maybeGc(): void {
  const g = (window as unknown as { gc?: () => void }).gc;
  if (g) g();
}

// ---- benchmark bench (owns one Pixi app for the page lifetime) ------------ //

const BENCH_W = 1280;
const BENCH_H = 720;

class Bench {
  app!: Application;
  manager!: AssetManager;
  controller!: EventDerivedEffectController;
  layer!: Container;
  sprites: Sprite[] = [];
  positions = new Map<string, { x: number; y: number }>();

  async init(): Promise<void> {
    this.app = new Application();
    await this.app.init({ width: BENCH_W, height: BENCH_H, preference: 'webgl', backgroundAlpha: 1 });
    this.app.ticker.stop(); // we drive render() manually per rAF for controlled measurement
    this.manager = new AssetManager({ registerDevelopmentManifest: false });
    this.manager.registerManifest(buildProductionManifest());
    this.layer = new Container();
    this.app.stage.addChild(this.layer);
    const adapter: EffectLayer = {
      addChild: (c) => {
        this.layer.addChild(c as unknown as Container);
      },
      removeChild: (c) => {
        this.layer.removeChild(c as unknown as Container);
      },
    };
    this.controller = new EventDerivedEffectController({
      assetManager: this.manager,
      layer: adapter,
      positionOf: (id) => this.positions.get(id),
      createSprite: (texture): EffectSprite => {
        const s = new Sprite((texture as Texture | null) ?? undefined);
        this.sprites.push(s);
        return s;
      },
    });
  }

  gl(): WebGL2RenderingContext | undefined {
    return (this.app.renderer as unknown as { gl?: WebGL2RenderingContext }).gl;
  }
  contextLost(): boolean {
    const gl = this.gl();
    return gl ? gl.isContextLost() : false;
  }
  glError(): number {
    const gl = this.gl();
    return gl ? gl.getError() : 0;
  }

  /** Warm the production textures into the AssetManager cache (cold load happens once). */
  async warmCache(): Promise<void> {
    const a = await this.manager.acquire(NETWORK_ID);
    const b = await this.manager.acquire(INCIDENT_ID);
    a.release();
    b.release();
  }

  reset(): void {
    this.controller.reset();
    this.sprites = [];
    this.positions.clear();
  }
}

let bench: Bench | null = null;
export async function getBench(): Promise<Bench> {
  if (!bench) {
    bench = new Bench();
    await bench.init();
    await bench.warmCache();
  }
  return bench;
}

// ---- occurrence generation ------------------------------------------------ //

let cursor = 0;
function networkEvent(i: number): EventEnvelope {
  cursor += 1;
  return {
    event_id: `n-${cursor}`, cursor, session_id: 's', session_revision: 1,
    tick: SPAWN_TICK, type: 'REQUEST_ROUTED', target: `app-${i}`,
    payload: { source_node_id: `lb-${i}`, target_node_id: `app-${i}`, count: 1 },
  };
}
function incidentEvent(i: number): EventEnvelope {
  cursor += 1;
  return {
    event_id: `i-${cursor}`, cursor, session_id: 's', session_revision: 1,
    tick: SPAWN_TICK, type: 'INCIDENT_OPENED', target: `node-${i}`,
    payload: { incident: `CAP_${i}`, phase: 'WARNING', metric: 0 },
  };
}

/** Deterministic distributed positions across the board (varied distance/angle). */
function placeDistributed(b: Bench, i: number, kind: 'network' | 'incident'): void {
  const cols = 16;
  const gx = 40 + (i % cols) * ((BENCH_W - 80) / cols);
  const gy = 40 + Math.floor(i / cols) * 44;
  if (kind === 'network') {
    // an edge lb-i -> app-i with a per-instance distance/angle
    b.positions.set(`lb-${i}`, { x: gx, y: gy });
    b.positions.set(`app-${i}`, { x: gx + 30 + (i % 7) * 12, y: gy + 10 + (i % 5) * 8 });
  } else {
    b.positions.set(`node-${i}`, { x: gx, y: gy });
  }
}
/** All alerts crowd the same small region (overlap/overdraw stress). */
function placeOverlap(b: Bench, i: number): void {
  b.positions.set(`node-${i}`, { x: BENCH_W / 2 + ((i % 5) - 2) * 3, y: BENCH_H / 2 + (Math.floor(i / 5) % 5 - 2) * 3 });
}

function eventsFor(b: Bench, scenario: Scenario, count: number): EventEnvelope[] {
  const evs: EventEnvelope[] = [];
  for (let i = 0; i < count; i++) {
    if (scenario === 'network_only_distributed') {
      placeDistributed(b, i, 'network'); evs.push(networkEvent(i));
    } else if (scenario === 'incident_only_distributed') {
      placeDistributed(b, i, 'incident'); evs.push(incidentEvent(i));
    } else if (scenario === 'incident_overlap') {
      placeOverlap(b, i); evs.push(incidentEvent(i));
    } else {
      // mixed ~50/50
      if (i % 2 === 0) { placeDistributed(b, i, 'network'); evs.push(networkEvent(i)); }
      else { placeDistributed(b, i, 'incident'); evs.push(incidentEvent(i)); }
    }
  }
  return evs;
}

// ---- frame measurement ---------------------------------------------------- //

async function measureFrames(b: Bench, warmup: number, measure: number): Promise<{
  intervals: number[]; renderMs: number[]; elapsedMs: number;
}> {
  return new Promise((resolve) => {
    const intervals: number[] = [];
    const renderMs: number[] = [];
    let last = performance.now();
    let seen = 0;
    const start = performance.now();
    const tick = (): void => {
      const now = performance.now();
      if (seen > 0 && seen > warmup) intervals.push(now - last);
      last = now;
      const r0 = performance.now();
      b.app.render();
      const r1 = performance.now();
      if (seen > warmup) renderMs.push(r1 - r0);
      seen += 1;
      if (seen <= warmup + measure) requestAnimationFrame(tick);
      else resolve({ intervals, renderMs, elapsedMs: now - start });
    };
    requestAnimationFrame(tick);
  });
}

// ---- one measurement point ------------------------------------------------ //

export async function runCapacityPoint(cfg: PointConfig): Promise<PointResult> {
  const b = await getBench();
  b.reset();
  b.controller.advanceTo(SPAWN_TICK);

  const evs = eventsFor(b, cfg.scenario, cfg.count);

  // Spawn burst: feed all events, then wait for all to become ACTIVE (async acquire).
  const feed0 = performance.now();
  for (const e of evs) b.controller.handleEvent(e);
  const feedMs = performance.now() - feed0;
  let framesToAllActive = 0;
  const deadline = performance.now() + 8000;
  while (b.controller.activeCount < cfg.count && performance.now() < deadline) {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    framesToAllActive += 1;
  }
  const allActive = b.controller.activeCount === cfg.count;

  // Steady state: tick held constant, effects remain ACTIVE. Measure frames.
  const heapSteadyPre = heapUsed();
  const { intervals, renderMs, elapsedMs } = await measureFrames(b, cfg.warmupFrames, cfg.measureFrames);

  // Controller steady update cost: advanceTo(held tick) iterates the registry (no expiry).
  const advMs: number[] = [];
  for (let k = 0; k < 120; k++) {
    const t0 = performance.now();
    b.controller.advanceTo(SPAWN_TICK);
    advMs.push(performance.now() - t0);
  }

  // Texture-sharing contract.
  const uniqueSources = new Set(b.layer.children.map((c) => (c as Sprite).texture?.source)).size;
  const networkRef = b.manager.refCountOf(NETWORK_ID);
  const incidentRef = b.manager.refCountOf(INCIDENT_ID);

  const activeCount = b.controller.activeCount;
  const spriteCount = b.layer.children.length;
  const contextLost = b.contextLost();
  const glError = b.glError();

  // Cleanup burst: advance past TTL, count frames until registry + sprites clear.
  b.controller.advanceTo(SPAWN_TICK + DURATION_TICKS);
  let framesToAllRemoved = 0;
  const cdeadline = performance.now() + 4000;
  while ((b.controller.activeCount > 0 || b.layer.children.length > 0) && performance.now() < cdeadline) {
    b.app.render();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    framesToAllRemoved += 1;
  }
  const refcountsZeroed = b.manager.refCountOf(NETWORK_ID) === 0 && b.manager.refCountOf(INCIDENT_ID) === 0;
  const allRemoved = b.controller.activeCount === 0 && b.layer.children.length === 0;

  const fs = summarize(intervals);
  const observedFps = intervals.length ? 1000 / (fs.p50 || 1) : 0;

  let status: PointResult['status'] = 'MEASURED_STABLE';
  if (contextLost) status = 'RUNTIME_UNSTABLE_OBSERVED';
  else if (!allActive || activeCount !== cfg.count || spriteCount !== cfg.count) status = 'MEASUREMENT_INVALID';

  return {
    scenario: cfg.scenario, count: cfg.count, repeat: cfg.repeat, status,
    frames: {
      observed: intervals.length, elapsedMs: Math.round(elapsedMs),
      intervalP50: +fs.p50.toFixed(3), intervalP95: +fs.p95.toFixed(3),
      intervalP99: +fs.p99.toFixed(3), intervalMax: +fs.max.toFixed(3),
      observedFps: +observedFps.toFixed(1),
    },
    renderSubmitMs: (() => { const r = summarize(renderMs); return { p50: +r.p50.toFixed(3), p95: +r.p95.toFixed(3), max: +r.max.toFixed(3) }; })(),
    controllerAdvanceMs: (() => { const a = summarize(advMs); return { p50: +a.p50.toFixed(4), p95: +a.p95.toFixed(4), max: +a.max.toFixed(4) }; })(),
    spawnBurst: { feedMs: +feedMs.toFixed(3), framesToAllActive, allActive },
    cleanupBurst: { framesToAllRemoved, allRemoved, refcountsZeroed },
    textures: { networkRef, incidentRef, uniqueTextureSources: uniqueSources },
    heap: { steadyUsedBytes: heapSteadyPre },
    correctness: { activeCount, spriteCount, contextLost, glError },
  };
}

// ---- cold / warm first-visible latency (count = 1) ------------------------ //

export interface LatencyResult { coldMs: number | null; warmMs: number | null; note: string }

export async function measureFirstVisibleLatency(): Promise<LatencyResult> {
  // COLD: a fresh AssetManager whose production texture is NOT yet cached.
  const coldMgr = new AssetManager({ registerDevelopmentManifest: false });
  coldMgr.registerManifest(buildProductionManifest());
  const coldApp = new Application();
  await coldApp.init({ width: 128, height: 128, preference: 'webgl', backgroundAlpha: 0 });
  coldApp.ticker.stop();
  const coldLayer = new Container();
  coldApp.stage.addChild(coldLayer);
  const coldSprites: Sprite[] = [];
  const coldCtl = new EventDerivedEffectController({
    assetManager: coldMgr,
    layer: { addChild: (c) => coldLayer.addChild(c as unknown as Container), removeChild: (c) => coldLayer.removeChild(c as unknown as Container) },
    positionOf: () => ({ x: 30, y: 30 }),
    createSprite: (t): EffectSprite => { const s = new Sprite((t as Texture | null) ?? undefined); coldSprites.push(s); return s; },
  });
  const extractNonEmpty = (app: Application, node: Container): number => {
    const out = app.renderer.extract.pixels(node);
    let n = 0; for (let i = 3; i < out.pixels.length; i += 4) if ((out.pixels[i] ?? 0) > 0) n += 1; return n;
  };
  const t0 = performance.now();
  coldCtl.advanceTo(SPAWN_TICK);
  coldCtl.handleEvent(incidentEvent(9001));
  let coldMs: number | null = null;
  const cd = performance.now() + 8000;
  while (performance.now() < cd) {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    coldApp.render();
    if (coldCtl.activeCount === 1 && extractNonEmpty(coldApp, coldLayer) > 0) { coldMs = performance.now() - t0; break; }
  }
  coldCtl.dispose();
  coldApp.destroy(true, { children: true });
  await coldMgr.disposeAll();

  // WARM: reuse the page bench whose textures are already cached.
  const b = await getBench();
  b.reset();
  b.controller.advanceTo(SPAWN_TICK);
  b.positions.set('node-9002', { x: 640, y: 360 });
  const w0 = performance.now();
  b.controller.handleEvent({ ...incidentEvent(9002), target: 'node-9002', payload: { incident: 'CAP_9002', phase: 'WARNING', metric: 0 } });
  let warmMs: number | null = null;
  const wd = performance.now() + 4000;
  while (performance.now() < wd) {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    b.app.render();
    if (b.controller.activeCount >= 1 && extractNonEmpty(b.app, b.layer) > 0) { warmMs = performance.now() - w0; break; }
  }
  b.reset();
  return { coldMs: coldMs === null ? null : +coldMs.toFixed(2), warmMs: warmMs === null ? null : +warmMs.toFixed(2), note: 'incident-alert first-visible; cold = uncached AssetManager, warm = page-cached texture' };
}

// ---- leak cycle (create -> expire -> cleanup) ----------------------------- //

export interface LeakCycle { cycle: number; activeAfter: number; spriteAfter: number; networkRef: number; incidentRef: number; heapUsedBytes: number | null }

export async function runLeakCycles(count: number, cycles: number): Promise<LeakCycle[]> {
  const b = await getBench();
  const out: LeakCycle[] = [];
  for (let c = 0; c < cycles; c++) {
    b.reset();
    b.controller.advanceTo(SPAWN_TICK);
    for (const e of eventsFor(b, 'incident_only_distributed', count)) b.controller.handleEvent(e);
    const dl = performance.now() + 6000;
    while (b.controller.activeCount < count && performance.now() < dl) await new Promise((r) => requestAnimationFrame(() => r(null)));
    b.app.render();
    b.controller.advanceTo(SPAWN_TICK + DURATION_TICKS); // expire all
    b.app.render();
    maybeGc();
    out.push({
      cycle: c, activeAfter: b.controller.activeCount, spriteAfter: b.layer.children.length,
      networkRef: b.manager.refCountOf(NETWORK_ID), incidentRef: b.manager.refCountOf(INCIDENT_ID),
      heapUsedBytes: heapUsed(),
    });
  }
  return out;
}
