/**
 * Test-page entry (NOT the production app). Proves a real WebGL2 context + runs the
 * event-derived effect scenarios against the REAL EventDerivedEffectController /
 * AssetManager and the REAL served production effect PNG. Results on
 * window.__eventDerivedResults.
 */
import { Application } from 'pixi.js';
import { runEventDerivedScenarios, type ScenarioResult } from './scenarios';

interface WebglInfo { webgl2: boolean; renderer?: string }
interface ResultsPayload {
  webgl: WebglInfo;
  pixiInit: boolean;
  scenarios: ScenarioResult[];
  errors: string[];
  allOk: boolean;
}

function webglInfo(): WebglInfo {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  if (!gl) return { webgl2: false };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return { webgl2: true, renderer: dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'unknown' };
}

async function main(): Promise<void> {
  const errors: string[] = [];
  window.addEventListener('error', (e) => errors.push(`error:${e.message}`));
  window.addEventListener('unhandledrejection', (e) =>
    errors.push(`unhandledrejection:${String((e as PromiseRejectionEvent).reason)}`),
  );

  const webgl = webglInfo();
  const probe = new Application();
  await probe.init({ width: 32, height: 32, preference: 'webgl' });
  const pixiInit = true;
  probe.destroy(true, { children: true });

  const scenarios = await runEventDerivedScenarios();
  const allOk = scenarios.every((s) => s.ok) && errors.length === 0 && webgl.webgl2;
  const payload: ResultsPayload = { webgl, pixiInit, scenarios, errors, allOk };
  (window as unknown as { __eventDerivedResults?: ResultsPayload }).__eventDerivedResults = payload;

  const el = document.createElement('pre');
  el.id = 'results';
  el.setAttribute('data-done', 'true');
  el.textContent = JSON.stringify(payload, null, 2);
  document.body.appendChild(el);
}

void main();
