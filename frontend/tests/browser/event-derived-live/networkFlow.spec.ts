/**
 * EVENT_DERIVED_LIVE_E2E — Path A: REAL REQUEST_ROUTED → Network Flow effect.
 *
 * The event originates from the actual simulation route path (engine.py::_route) via
 * the real command + manual-tick APIs — NOT injected into the frontend. Verified by a
 * native WebSocket frame observation bound to the exact event, plus a color-keyed
 * (CYAN) canvas pixel delta for the rendered beam, and simulation-tick TTL expiry.
 */
import { test, expect } from '@playwright/test';
import {
  API, createSession, addNode, connect, disconnect, advance,
  collectDomainEvents, countChanged, countNewColor, isCyan, snapshot, capture, type DomainEvent,
} from './helpers';

const OUT = 'test-results/event-derived-live/network-flow';

async function pollUntil(fn: () => Promise<number>, ok: (n: number) => boolean, label: string, timeoutMs = 12_000): Promise<number> {
  const start = Date.now();
  let last = NaN;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (ok(last)) return last;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timeout waiting for ${label}: last=${last}`);
}

test('LIVE Path A: real _route REQUEST_ROUTED renders the network-flow beam then expires by tick TTL', async ({ page }) => {
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(`pageerror:${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`console:${m.text()}`); });
  const routed: DomainEvent[] = collectDomainEvents(page, 'REQUEST_ROUTED');

  // Real topology + demand via supported command APIs (users seed traffic).
  const sid = await createSession(page.request, 80);
  await addNode(page.request, sid, 'lb-1', 'load_balancer', 'a1');
  await addNode(page.request, sid, 'app-1', 'app_server', 'a2');
  await connect(page.request, sid, 'lb-1', 'app-1', 'a3');

  await page.goto(`/game/${sid}`);
  await page.waitForSelector('canvas', { timeout: 20_000 });
  await page.waitForTimeout(800);
  // Baseline BEFORE any routing. The beam is measured as pixels that BECOME cyan vs this
  // exact frame (countNewColor), cancelling the constant building/connection background.
  const base = await capture(page, '01-baseline', OUT);

  // Advance ONE tick → real _route emits REQUEST_ROUTED live over the WebSocket.
  await advance(page.request, sid, 1);
  await expect.poll(() => routed.length, { timeout: 10_000, message: 'REQUEST_ROUTED over real socket' }).toBeGreaterThan(0);
  const first = routed[0]!;
  expect(first.payload['source_node_id'], 'live source').toBe('lb-1');
  expect(first.payload['target_node_id'], 'live target').toBe('app-1');
  expect(Number.isInteger(first.tick), 'real sim tick').toBeTruthy();
  expect(Number(first.payload['count']), 'real routed count').toBeGreaterThan(0);

  // The beam is a thin, semi-transparent cyan strip along the LB→APP edge. It is measured
  // by pixels that changed vs the aligned baseline (only the beam changes this static
  // scene); the cyan tint confirms it is the network-flow effect, not something else.
  const active = await pollUntil(
    async () => countChanged(await snapshot(page), base), (n) => n >= 40, 'network-flow beam',
  );
  const activeFrame = await capture(page, '02-active', OUT);
  const activeCyan = countNewColor(activeFrame, base, isCyan);
  expect(active, 'beam appeared on the LB→APP edge').toBeGreaterThanOrEqual(40);
  expect(activeCyan, 'the appeared beam is cyan (network-flow)').toBeGreaterThanOrEqual(6);

  // Stop further matching traffic, then advance past event.tick + durationTicks(6).
  await disconnect(page.request, sid, 'lb-1', 'app-1', 'a4');
  for (let i = 0; i < 9; i++) await advance(page.request, sid, 1);
  const expired = await pollUntil(
    async () => countChanged(await snapshot(page), base), (n) => n < 25, 'beam expiry',
  );
  await capture(page, '03-post-ttl', OUT);
  expect(expired, 'beam gone after tick TTL (returns to baseline)').toBeLessThan(25);

  expect(errs, 'no console/page errors').toEqual([]);
  // eslint-disable-next-line no-console
  console.log(`NETWORK_FLOW_LIVE changedActive=${active} newCyanActive=${activeCyan} changedPostTTL=${expired} api=${API}`);
});
