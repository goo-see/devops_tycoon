/**
 * EVENT_DERIVED_RUNTIME_CAPACITY_BASELINE driver.
 *
 * Sweeps the measurement ladder × scenarios × repeats against the real runtime benchmark
 * (window.__capacity), captures zero-effect controls before/after, cold/warm first-visible
 * latency, and leak cycles, then writes a machine-readable artifact to (gitignored)
 * evidence/event-derived-capacity/baseline.json. Summary tables go in the committed doc.
 *
 * NO performance target is asserted. Only correctness invariants are asserted (real WebGL2,
 * texture sharing, no context loss at low counts, no in-page errors). Runtime instability at
 * high load is a valid MEASURED OUTCOME, recorded — not a test failure.
 */
import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PointResult, Scenario, EnvInfo, LatencyResult, LeakCycle } from './benchmark';

const OUT = resolve('..', 'evidence', 'event-derived-capacity');

const COUNTS = (process.env.CAP_COUNTS ?? '0,1,4,8,16,32,64,128').split(',').map(Number);
const REPEATS = Number(process.env.CAP_REPEATS ?? '3');
const WARMUP = Number(process.env.CAP_WARMUP ?? '60');
const MEASURE = Number(process.env.CAP_MEASURE ?? '180'); // see doc §methodology (deviates from 300 for total-runtime reliability)
const SCENARIOS: Scenario[] = (process.env.CAP_SCENARIOS ??
  'network_only_distributed,incident_only_distributed,mixed_distributed,incident_overlap').split(',') as Scenario[];

type Api = {
  env: () => EnvInfo;
  run: (cfg: { scenario: Scenario; count: number; repeat: number; warmupFrames: number; measureFrames: number }) => Promise<PointResult>;
  latency: () => Promise<LatencyResult>;
  leak: (count: number, cycles: number) => Promise<LeakCycle[]>;
  errors: string[];
};
test('EVENT_DERIVED runtime capacity baseline (real runtime, MEASURED)', async ({ page }, testInfo) => {
  testInfo.setTimeout(900_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(`pageerror:${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console:${m.text()}`); });

  // Count production-image fetches (§17) — cold first load vs warm cache.
  let effectImageRequests = 0;
  page.on('request', (r) => { if (/\/assets\/effect\/.*\.png/.test(r.url())) effectImageRequests += 1; });

  await page.goto('/');
  await page.waitForSelector('#ready[data-ready="true"]', { timeout: 60_000 });
  const requestsAfterWarm = effectImageRequests; // getBench() warmed both textures once

  const env = await page.evaluate(() => (window as unknown as { __capacity: Api }).__capacity.env());
  expect(env.webgl2, 'real WebGL2').toBe(true);
  // eslint-disable-next-line no-console
  console.log(`CAP env: renderer=${env.renderer} dpr=${env.devicePixelRatio} vp=${env.viewport.width}x${env.viewport.height} gpuTimer=${env.gpuTimerQuery} preciseMem=${env.preciseMemory}`);

  const runPoint = (scenario: Scenario, count: number, repeat: number) =>
    page.evaluate((cfg) => (window as unknown as { __capacity: Api }).__capacity.run(cfg),
      { scenario, count, repeat, warmupFrames: WARMUP, measureFrames: MEASURE });

  const zeroBefore = await runPoint('network_only_distributed', 0, 0);

  const points: PointResult[] = [];
  for (const scenario of SCENARIOS) {
    let unstable = false;
    for (const count of COUNTS) {
      if (unstable) { console.log(`CAP skip ${scenario}@${count} (prior RUNTIME_UNSTABLE)`); break; }
      for (let r = 0; r < REPEATS; r++) {
        const p = await runPoint(scenario, count, r);
        points.push(p);
        // eslint-disable-next-line no-console
        console.log(`CAP ${scenario}@${count}#${r} ${p.status} fps=${p.frames.observedFps} p95=${p.frames.intervalP95}ms render_p95=${p.renderSubmitMs.p95}ms adv_p95=${p.controllerAdvanceMs.p95}ms tex=${p.textures.uniqueTextureSources} refN=${p.textures.networkRef} refI=${p.textures.incidentRef} ctxLost=${p.correctness.contextLost}`);
        if (p.status === 'RUNTIME_UNSTABLE_OBSERVED') unstable = true;
      }
      if (unstable) break;
    }
  }

  const latency = await page.evaluate(() => (window as unknown as { __capacity: Api }).__capacity.latency());
  const leak32 = await page.evaluate(() => (window as unknown as { __capacity: Api }).__capacity.leak(32, 20));
  const stable64 = points.some((p) => p.count === 64 && p.scenario === 'incident_only_distributed' && p.status === 'MEASURED_STABLE');
  const leak64 = stable64 ? await page.evaluate(() => (window as unknown as { __capacity: Api }).__capacity.leak(64, 20)) : [];

  const zeroAfter = await runPoint('network_only_distributed', 0, 99);
  const inPageErrors = await page.evaluate(() => (window as unknown as { __capacity: Api }).__capacity.errors);

  const artifact = {
    git_sha: process.env.CAP_GIT_SHA ?? 'unknown',
    generated_note: 'MEASURED on the environment below; CI software-renderer numbers must not be mixed with hardware numbers',
    environment: env,
    methodology: { warmupFrames: WARMUP, measureFrames: MEASURE, repeats: REPEATS, counts: COUNTS, scenarios: SCENARIOS, note: 'ticker stopped; render() driven per rAF; tick held constant during steady state; expiry via advanceTo(tick+6)' },
    effect_image_requests: { afterWarmup: requestsAfterWarm, afterFullSweep: effectImageRequests, note: 'warm cache => no per-sprite fetch' },
    zero_baseline_before: zeroBefore,
    zero_baseline_after: zeroAfter,
    cold_warm_first_visible: latency,
    points,
    leak_cycles_32: leak32,
    leak_cycles_64: leak64,
    in_page_errors: inPageErrors,
    page_errors: pageErrors,
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, 'baseline.json'), JSON.stringify(artifact, null, 2));
  // eslint-disable-next-line no-console
  console.log(`CAP wrote ${resolve(OUT, 'baseline.json')}  points=${points.length} coldMs=${latency.coldMs} warmMs=${latency.warmMs} imgReq=${effectImageRequests}`);

  // ---- correctness invariants only (NO performance thresholds) ----
  const lowStable = points.filter((p) => p.count <= 16);
  for (const p of lowStable) {
    expect(p.status, `low-count point ${p.scenario}@${p.count}#${p.repeat} stable`).not.toBe('MEASUREMENT_INVALID');
    expect(p.correctness.contextLost, `no context loss at low count ${p.scenario}@${p.count}`).toBe(false);
  }
  // Texture-sharing contract across all operational points.
  for (const p of points.filter((x) => x.count > 0 && x.status !== 'RUNTIME_UNSTABLE_OBSERVED' && x.status !== 'MEASUREMENT_INVALID')) {
    expect(p.textures.uniqueTextureSources, `≤2 production TextureSources ${p.scenario}@${p.count}`).toBeLessThanOrEqual(2);
    if (p.scenario === 'network_only_distributed') expect(p.textures.networkRef, `network refcount == count`).toBe(p.count);
    if (p.scenario === 'incident_only_distributed' || p.scenario === 'incident_overlap') expect(p.textures.incidentRef, `incident refcount == count`).toBe(p.count);
  }
  // Cleanup returns to baseline (leak correctness).
  for (const c of leak32) {
    expect(c.activeAfter, `leak cycle ${c.cycle} active→0`).toBe(0);
    expect(c.spriteAfter, `leak cycle ${c.cycle} sprites→0`).toBe(0);
    expect(c.incidentRef, `leak cycle ${c.cycle} incident refcount→0`).toBe(0);
  }
  expect(inPageErrors, 'no in-page errors').toEqual([]);
  expect(pageErrors, 'no page/console errors').toEqual([]);
});
