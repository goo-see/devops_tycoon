/**
 * Shared helpers for the durable Event-Derived LIVE E2E harness.
 *
 *  - Real command/tick API against the running backend (no injection).
 *  - Native Playwright WebSocket observation (no product debug global / page hook).
 *  - Color-keyed pixel metrics over real canvas screenshots (pngjs decode):
 *      * network flow  = CYAN  (nothing else on the board is cyan),
 *      * incident alert = AMBER (the warm ring/rays/glow; the persistent red
 *        active-incident STATUS badge is a different, redder color and is excluded
 *        by the amber key — see §9/§10: we do NOT assert every warm pixel → 0).
 */
import { expect, type Page, type APIRequestContext } from '@playwright/test';
import { PNG } from 'pngjs';

export const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:8000';

// ---- real backend command / tick API -------------------------------------- //

export interface DomainEvent {
  type: string;
  tick: number;
  target: string | null;
  payload: Record<string, unknown>;
  cursor: number;
}

async function post(request: APIRequestContext, path: string, data: unknown): Promise<unknown> {
  const res = await request.post(`${API}${path}`, { data: data as Record<string, unknown> });
  expect(res.ok(), `POST ${path} -> ${res.status()}`).toBeTruthy();
  return res.json();
}

export async function createSession(request: APIRequestContext, users = 80): Promise<string> {
  const body = (await post(request, '/api/v1/game-sessions', { seed: 7, users })) as { session_id: string };
  return body.session_id;
}
export function addNode(request: APIRequestContext, sid: string, id: string, kind: string, cid: string): Promise<unknown> {
  return post(request, `/api/v1/game-sessions/${sid}/commands`, {
    command_id: cid, command_type: 'ADD_NODE', payload: { target: id, node_kind: kind },
  });
}
export function connect(request: APIRequestContext, sid: string, from: string, to: string, cid: string): Promise<unknown> {
  return post(request, `/api/v1/game-sessions/${sid}/commands`, {
    command_id: cid, command_type: 'CONNECT', payload: { target: from, to },
  });
}
export function disconnect(request: APIRequestContext, sid: string, from: string, to: string, cid: string): Promise<unknown> {
  return post(request, `/api/v1/game-sessions/${sid}/commands`, {
    command_id: cid, command_type: 'DISCONNECT', payload: { target: from, to },
  });
}
export function disableServer(request: APIRequestContext, sid: string, id: string, cid: string): Promise<unknown> {
  return post(request, `/api/v1/game-sessions/${sid}/commands`, {
    command_id: cid, command_type: 'DISABLE_SERVER', payload: { target: id },
  });
}
export function advance(request: APIRequestContext, sid: string, ticks: number): Promise<unknown> {
  return post(request, `/internal/v1/game-sessions/${sid}/advance`, { ticks });
}

// ---- native WebSocket observation (no page hook) -------------------------- //

/** Collect DomainEvents of `type` from the REAL game socket via Playwright's WS API.
 * Returns a live array populated as frames arrive; attach BEFORE navigation. */
export function collectDomainEvents(page: Page, type: string): DomainEvent[] {
  const out: DomainEvent[] = [];
  page.on('websocket', (ws) => {
    ws.on('framereceived', (frame) => {
      const raw = typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf8');
      if (!raw.includes(type)) return;
      try {
        const msg = JSON.parse(raw) as Record<string, unknown>;
        const candidates =
          msg['message_type'] === 'DOMAIN_EVENT' && msg['payload']
            ? [msg['payload']]
            : Array.isArray(msg['events'])
              ? (msg['events'] as unknown[])
              : msg['type']
                ? [msg]
                : [];
        for (const c of candidates) {
          const e = c as DomainEvent;
          if (e && e.type === type) out.push(e);
        }
      } catch {
        /* non-JSON frame */
      }
    });
  });
  return out;
}

// ---- color-keyed pixel metrics ------------------------------------------- //

export interface Region { x0: number; y0: number; x1: number; y1: number }

/** Decode the current canvas frame without persisting (for polling). */
export async function snapshot(page: Page): Promise<PNG> {
  return PNG.sync.read(await page.locator('canvas').first().screenshot());
}

/** Decode + persist the current canvas frame as an evidence artifact. */
export async function capture(page: Page, name: string, outDir: string): Promise<PNG> {
  const buf = await page.locator('canvas').first().screenshot();
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/${name}.png`, buf);
  return PNG.sync.read(buf);
}

type Keyer = (r: number, g: number, b: number) => boolean;

/** CYAN — the network-flow beam (mean ≈ rgb(84,202,208)). The board's buildings carry a
 * constant cyan residual, so the beam is measured by `countNewColor` (pixels that BECAME
 * cyan vs the aligned baseline), which cancels the constant background exactly. */
export const isCyan: Keyer = (r, g, b) => b > 150 && g > 120 && r < 120;

/** AMBER — the incident alert ring/rays/glow. Excludes the redder persistent
 * active-incident status badge (badge G is ~40, far below the 90 floor). */
export const isAmber: Keyer = (r, g, b) => r > 180 && g >= 90 && g <= 205 && b < 120 && r - g > 40 && g - b > 30;

/** Count pixels that match `key` in `png` but did NOT in the aligned `base` — i.e. the
 * effect's own contribution, with the constant background (buildings, connection lines,
 * persistent badges) cancelled. Requires identical dimensions (static camera). */
export function countNewColor(png: PNG, base: PNG, key: Keyer): number {
  const { width, height, data } = png;
  const bd = base.data;
  if (base.width !== width || base.height !== height) throw new Error('frame size mismatch');
  let n = 0;
  for (let p = 0; p < data.length; p += 4) {
    const nowMatch = key(data[p] ?? 0, data[p + 1] ?? 0, data[p + 2] ?? 0);
    if (!nowMatch) continue;
    const wasMatch = key(bd[p] ?? 0, bd[p + 1] ?? 0, bd[p + 2] ?? 0);
    if (!wasMatch) n += 1;
  }
  return n;
}

/** Count pixels whose color changed materially vs the aligned `base` frame. In the
 * controlled live scene (static camera, no other animation) the only source of change
 * between baseline and the effect frame is the effect itself. */
export function countChanged(png: PNG, base: PNG, minDelta = 40): number {
  const { width, height, data } = png;
  const bd = base.data;
  if (base.width !== width || base.height !== height) throw new Error('frame size mismatch');
  let n = 0;
  for (let p = 0; p < data.length; p += 4) {
    const d =
      Math.abs((data[p] ?? 0) - (bd[p] ?? 0)) +
      Math.abs((data[p + 1] ?? 0) - (bd[p + 1] ?? 0)) +
      Math.abs((data[p + 2] ?? 0) - (bd[p + 2] ?? 0));
    if (d > minDelta) n += 1;
  }
  return n;
}

export function countColor(png: PNG, key: Keyer, region?: Region): number {
  const { width, height, data } = png;
  const x0 = region ? Math.max(0, region.x0) : 0;
  const y0 = region ? Math.max(0, region.y0) : 0;
  const x1 = region ? Math.min(width, region.x1) : width;
  const y1 = region ? Math.min(height, region.y1) : height;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      if (key(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0)) n += 1;
    }
  }
  return n;
}
