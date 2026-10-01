/**
 * Capacity harness entry (NOT the production app). Exposes the benchmark on
 * `window.__capacity` so the Playwright driver can run each scenario/count/repeat point
 * and collect machine-readable results. Uses the REAL controller/AssetManager/textures.
 */
import {
  collectEnv, runCapacityPoint, measureFirstVisibleLatency, runLeakCycles, getBench,
  type PointConfig,
} from './benchmark';

declare global {
  interface Window {
    __capacity?: {
      env: typeof collectEnv;
      run: (cfg: PointConfig) => ReturnType<typeof runCapacityPoint>;
      latency: typeof measureFirstVisibleLatency;
      leak: typeof runLeakCycles;
      errors: string[];
    };
    __capacityReady?: boolean;
  }
}

async function main(): Promise<void> {
  const errors: string[] = [];
  window.addEventListener('error', (e) => errors.push(`error:${e.message}`));
  window.addEventListener('unhandledrejection', (e) => errors.push(`unhandledrejection:${String((e as PromiseRejectionEvent).reason)}`));

  await getBench(); // init Pixi + warm production textures once
  window.__capacity = {
    env: collectEnv,
    run: (cfg) => runCapacityPoint(cfg),
    latency: measureFirstVisibleLatency,
    leak: runLeakCycles,
    errors,
  };
  window.__capacityReady = true;

  const el = document.createElement('pre');
  el.id = 'ready';
  el.setAttribute('data-ready', 'true');
  el.textContent = 'capacity harness ready';
  document.body.appendChild(el);
}

void main();
