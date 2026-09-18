# EVENT_DERIVED Live E2E Automation — Durable Real-Stack Regression

Status: **EVENT_DERIVED_LIVE_E2E_AUTOMATION = IMPLEMENTED_PENDING_DEVCTO_REVIEW**.
Base dev `d46ecfc`. Branch `infra/platform`. Test/harness/CI-only — **zero product-code,
asset, backend, simulation, or contract change**.

Converts the previously throwaway manual live-stack evidence for the two approved
event→effect mappings into a durable, committed automated regression:

| Path | Real origin | Effect |
| --- | --- | --- |
| A | `simulation/engine.py::_route` → `REQUEST_ROUTED` | `effect.network-flow.primary` |
| B | `simulation/incidents/evaluator.py` → `INCIDENT_OPENED` | `effect.incident-alert.primary` |

Events originate from actual simulation execution driven through the supported command +
manual-tick APIs. There is **no** frontend event injection (no
`controller.handleEvent(...)`, no store push, no synthetic DomainEvent).

## Run it

```
cd frontend
pnpm test:browser:event-derived-live          # one command: boots stack, runs, cleans up
PW_ANGLE=metal pnpm test:browser:event-derived-live   # local Apple-GPU hardware run
```

`tests/browser/event-derived-live/launch.mjs` is the launcher. It:

1. allocates two free `127.0.0.1` ports (backend + frontend),
2. starts the real FastAPI backend (in-memory storage; `DEVOPS_TYCOON_ENABLE_MANUAL_TICK_API=true`)
   bound to `127.0.0.1` — avoiding ambiguous `localhost` IPv4/IPv6 resolution,
3. starts a Vite server (the real app; `tests/browser/event-derived-live/vite.config.ts`)
   whose proxy targets the exact backend port (from `E2E_BACKEND_URL`),
4. waits with **bounded readiness polling** on `/health/live` and the frontend root — no
   arbitrary sleeps; a timeout fails with the offending URL + last error,
5. runs the Playwright specs against those exact URLs (`E2E_BASE_URL` / `E2E_API_URL`),
6. **tears down every child process it started** (success / failure / timeout / SIGINT) via
   process groups, leaving no orphan server or occupied port. It never kills unrelated
   processes. Extra args pass through to `playwright test` (e.g. `--repeat-each=10`).

Backend interpreter resolution: `$E2E_PYTHON`, else the repo `.venv-ops-rv3/bin/python`,
else `python3`.

## Infrastructure requirement

The exercised simulation paths (`_route`, incident evaluator) run on **in-memory**
simulation state. **PostgreSQL / Redis are NOT required** and are not provisioned. (If a
future scenario needs them, CI must provision them explicitly rather than silently skip.)

## Observation & assertions

- **Real event binding:** native Playwright WebSocket observation
  (`page.on('websocket')` → `framereceived`) captures the exact `DOMAIN_EVENT` envelope
  from the real game socket — **no product debug global / page hook**. Path A asserts
  `source_node_id=lb-1`, `target_node_id=app-1`, integer tick, `count>0`. Path B asserts
  `incident=NO_HEALTHY_SERVER`, `target=lb-1` (node-centered, not APP/board).
- **Rendered-effect evidence (pngjs over real canvas screenshots):**
  - Network flow beam is thin/semi-transparent → measured by **pixels changed vs the
    aligned baseline** (`countChanged`; only the beam changes this static scene) plus a
    **new-cyan** tint check (`countNewColor` with the beam's saturated-cyan key). Observed
    stable: `changed≈81`, `newCyan≈19`; post-TTL `changed=0`.
  - Incident alert is a large node-centered radial → measured by **AMBER** pixel count
    (`isAmber`). Observed stable: baseline `0`, active `869`, post-TTL `0`.
- **Simulation-time expiry (§6/§9):** effects are removed by advancing simulation ticks
  past `event.tick + durationTicks(6)` — never wall-clock waiting. Network flow: traffic is
  stopped (DISCONNECT) so no new beam spawns. Incident: `INCIDENT_PHASE_CHANGED` is
  unmapped, so no new alert spawns.
- **Badge vs alert (§9/§10):** the incident expiry uses the AMBER key, which **excludes**
  the separate persistent active-incident STATUS badge (a redder marker). We do NOT assert
  every warm pixel → 0; we assert the AMBER radial alert returns to baseline.
- **Error contract (§23):** each spec asserts 0 page errors and 0 unexpected console errors;
  Playwright captures WebGL context loss as page errors. Traces/screenshots retained on
  failure only.

## Renderers (kept separate — never conflated)

- `LOCAL_HARDWARE_LIVE_E2E`: Apple M4 Max, `ANGLE (Apple, ANGLE Metal Renderer: Apple M4
  Max)`, SwiftShader = FALSE (`PW_ANGLE=metal`).
- `CI_AUTOMATED_LIVE_E2E`: GitHub `ubuntu-latest`, Chromium software/SwiftShader renderer
  (default). CI evidence is **not** a hardware-GPU result.

## Stability evidence

- **Local (Apple M4 Max / Metal): 10 consecutive runs, 10 pass / 0 fail.** Metrics were
  bit-stable every run (network flow `changed=81 newCyan=19 postTTL=0`; incident
  `0 / 869 / 0`). Per-test wall time ≈ 3.8 s; full command (stack boot + 2 specs + teardown)
  ≈ 15–20 s. No orphan process or leaked port after 10 runs.
- **CI: `event-derived-live-e2e`** workflow, **NON-REQUIRED** check (branch protection is
  unchanged; the only required check remains `asset-production-gate`). CI run results are
  recorded on the PR; making this required is a separate DevCTO/Ops action after stability
  is confirmed across repeated CI executions.

## Product contract (unchanged)

Zero change to: `REQUEST_ROUTED` / `INCIDENT_OPENED` contracts, `durationTicks`, occurrence
identities, placement strategies, AssetManager ownership, production assets. Asset state
unchanged: included **6**, `build_id ee6b2c89…`, C17 83,773 B, C18 6,291,456 B;
verify-generated PASS, C01–C26 26/26, asset-production-gate SUCCESS.

## Scope boundary

- Supplements (does not replace) the deterministic unit + committed browser harnesses
  (`asset-runtime`, `production-image`, `effect-preview`, `event-derived-effect`, `visual-c`).
- Live coexistence (network flow + incident simultaneously) is intentionally kept in the
  committed `event-derived-effect` harness (deterministic), not the live suite, to keep the
  two required single-path live tests robust (§22).
- Does NOT establish effect performance/sprite/overdraw capacity (next track).
- `INCIDENT_ALERT_PNG_SIZE_OPTIMIZATION` remains `PROPOSED / NON_BLOCKING` (not touched).
