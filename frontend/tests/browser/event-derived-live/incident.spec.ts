/**
 * EVENT_DERIVED_LIVE_E2E — Path B: REAL INCIDENT_OPENED → Incident Alert effect.
 *
 * The incident originates from the actual simulation incident evaluator
 * (incidents/evaluator.py): an LB→APP topology with the app server DISABLED under demand
 * opens a canonical NO_HEALTHY_SERVER incident on the LB — NOT injected. Verified by a
 * native WebSocket frame observation, an AMBER-keyed canvas pixel delta for the rendered
 * node-centered alert, and simulation-tick TTL expiry.
 *
 * §9/§10: expiry asserts the AMBER radial alert returns near baseline. The separate,
 * persistent active-incident STATUS badge (a redder marker) is intentionally EXCLUDED by
 * the amber color key, so we do NOT require every warm pixel to reach zero.
 */
import { test, expect } from '@playwright/test';
import {
  API, createSession, addNode, connect, disableServer, advance,
  collectDomainEvents, countColor, isAmber, snapshot, capture, type DomainEvent,
} from './helpers';

const OUT = 'test-results/event-derived-live/incident';

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

test('LIVE Path B: real NO_HEALTHY_SERVER incident renders the node-centered alert then expires by tick TTL', async ({ page }) => {
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(`pageerror:${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`console:${m.text()}`); });
  const opened: DomainEvent[] = collectDomainEvents(page, 'INCIDENT_OPENED');

  const sid = await createSession(page.request, 80);
  await addNode(page.request, sid, 'lb-1', 'load_balancer', 'a1');
  await addNode(page.request, sid, 'app-1', 'app_server', 'a2');
  await connect(page.request, sid, 'lb-1', 'app-1', 'a3');
  await disableServer(page.request, sid, 'app-1', 'a4'); // no healthy server behind the LB

  await page.goto(`/game/${sid}`);
  await page.waitForSelector('canvas', { timeout: 20_000 });
  await page.waitForTimeout(800);
  const baseline = countColor(await capture(page, '01-baseline', OUT), isAmber);
  expect(baseline, 'no alert before any incident').toBeLessThan(50);

  // Advance ONE tick → the real incident evaluator opens NO_HEALTHY_SERVER on the LB.
  await advance(page.request, sid, 1);
  await expect.poll(() => opened.length, { timeout: 10_000, message: 'INCIDENT_OPENED over real socket' }).toBeGreaterThan(0);
  const first = opened[0]!;
  expect(first.payload['incident'], 'live incident type').toBe('NO_HEALTHY_SERVER');
  expect(first.target, 'live incident target is the LB (node-centered, not APP/board)').toBe('lb-1');
  expect(Number.isInteger(first.tick), 'real sim tick').toBeTruthy();

  const active = await pollUntil(
    async () => countColor(await snapshot(page), isAmber), (n) => n >= baseline + 150, 'incident alert',
  );
  await capture(page, '02-active', OUT);
  expect(active, 'node-centered alert visible').toBeGreaterThan(baseline + 150);

  // Advance past event.tick + 6. INCIDENT_PHASE_CHANGED (WARNING→ACTIVE) is unmapped,
  // so no new alert spawns; the transient opening alert expires.
  for (let i = 0; i < 9; i++) await advance(page.request, sid, 1);
  const expired = await pollUntil(
    async () => countColor(await snapshot(page), isAmber), (n) => n < baseline + 60, 'alert expiry',
  );
  await capture(page, '03-post-ttl', OUT);
  expect(expired, 'radial alert gone after tick TTL (amber near baseline; red status badge excluded)').toBeLessThan(baseline + 60);

  expect(errs, 'no console/page errors').toEqual([]);
  // eslint-disable-next-line no-console
  console.log(`INCIDENT_LIVE baseline=${baseline} active=${active} postTTL=${expired} api=${API}`);
});
