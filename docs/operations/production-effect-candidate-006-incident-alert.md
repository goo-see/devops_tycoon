# Production Effect Candidate #006 — Incident Alert

Status: **PRODUCTION_EFFECT_CANDIDATE_006 = READY_FOR_DEVCTO_EFFECT_ASSET_REVIEW**
(do NOT self-declare `APPROVED_IN_DEV`). Base dev `50f3f80`. Candidate branch
`candidate/production-effect-006-incident-alert`.

The second production effect asset, validated through the already-approved
`EVENT_DERIVED` runtime (`POLICY-C-FU-002 = COMPLETE_IN_DEV`). It onboards a new
production IMAGE RESOURCE (`effect.incident-alert.primary`) **and** wires a new explicit
event mapping `INCIDENT_OPENED → effect.incident-alert.primary` with a node-centered
placement strategy.

Distinct concerns, kept separate:

- **Incident Alert Resource** — this candidate's asset-approval target.
- **EVENT_DERIVED Framework** — already `COMPLETE_IN_DEV`; unchanged here.
- **New Mapping** — `INCIDENT_OPENED → effect.incident-alert.primary` (target-node).
- **Performance capacity** — `NOT_CONFIRMED` (1/4/8 runs are `RUNTIME_SANITY_EVIDENCE`).

## Preimplementation event inventory (INCIDENT_OPENED)

`INCIDENT_OPENED` is emitted by `simulation/incidents/evaluator.py::_maybe_open`
(via `evaluate_incidents`) when an incident first opens in the `WARNING` phase.

- **target**: the affected node id (`signal.target`) — carried in the envelope `target`.
- **detail (payload)**: `{ "incident": <IncidentType>, "phase": "WARNING", "metric": <float>,
  "event_id": <static catalog code, e.g. EVT-SRV-001> }`.
- **No per-instance incident_id** — `event_id` is a static per-type catalog code, NOT a
  unique occurrence id.
- **Multiplicity**: the incident book is keyed by `(type, target)`, so at most ONE
  `INCIDENT_OPENED` per `(type, target)` per tick; DIFFERENT incident types MAY open on
  the same target in the same tick.
- **Replay/dup**: like all DomainEvents, deduped by `event_id` in the store; the effect
  controller additionally dedups by occurrence key.

## Occurrence identity

No canonical `incident_id` exists, and `tick + target` alone is unsafe (two different
incident types can open on the same target in one tick). Identity therefore uses
**`incident_type + tick + target`**:

`incident-opened:<tick>:<target>:<incidentType>` (deterministic, never a UUID).

## Mapping (exact allowlist — two entries)

| eventType | assetId | placement | durationTicks |
| --- | --- | --- | --- |
| `REQUEST_ROUTED` | `effect.network-flow.primary` | `source-to-target` | 6 |
| `INCIDENT_OPENED` | `effect.incident-alert.primary` | `target-node` | 6 |

No inference: no name convention, no substring match, no category inference, no
unknown-event fallback. `INCIDENT_PHASE_CHANGED`, `INCIDENT_RESOLVED`, and `NODE_*` are
intentionally NOT mapped — only `INCIDENT_OPENED` spawns an alert.

## Placement & transform (TARGET_NODE)

A second explicit placement strategy `target-node` was added (alongside
`source-to-target`). The alert is centered on `scene.positionOf(event.target)`; a missing
target position → SKIP (no board-center fallback). Deterministic node-centered transform
(single source of truth in `EventDerivedEffectController.ts`): anchor `(0.5,0.5)`, fixed
square size `96px`, fixed vertical offset `-6px`, rotation `0` (radial, non-directional).

## Semantic model & TTL

Incident Alert is a TRANSIENT presentation of "an incident just OPENED on this node". It
does NOT claim a cause, a fire, a permanent failure, or that the incident stays active
while the alert shows. Visibility is a fixed presentation TTL — `durationTicks = 6`
(simulation-time, `expiresAtTick = event.tick + 6`), deliberately NOT tied to
`INCIDENT_RESOLVED`. `count`: N/A for incidents. The value matches Network Flow's 6 ticks
for board consistency. Frame-rate independent; identical tick-count lifetime at 1x/2x/4x.

## Ownership (unchanged framework)

Per-occurrence Sprite; per-consumer AssetManager handle; ONE shared `TextureSource` per
effect asset; the AssetManager owns texture lifecycle. Sprite cleanup uses
`destroy({texture:false, textureSource:false, children:true})` — never destroys the shared
texture. Generation-guarded async acquire; reset/dispose invalidate the generation, release
handles, remove sprites, and unsubscribe. `EFFECT → SIMULATION` feedback is impossible.

## Asset resource

- Source: `assets/source/effect/incident-alert.png` — **512×512 RGBA8**, PNG (no atlas,
  no animation, no particle engine).
- Motif: node-centered red-orange radial hazard glow + 12-segment amber warning ring +
  eight short radial warning rays + central "attention" exclamation. Deterministic
  (PIL/numpy, no randomness, no external reference, no vendor logo, no literal
  flame/explosion/smoke/skull). Generic "attention: incident here" — NOT root-cause or
  vendor-specific. NOT recolored from Network Flow; NOT reused from FU-009 evidence.
- Alpha: opaque **0.00%**, partial **66.75%**, transparent **33.25%** — TRUE_ALPHA,
  partial > 0, no baked/opaque background. Visible bbox `(6,6)-(505,505)`.
- Transfer bytes: 62,263 B. Checksum (source == metadata == runtime):
  `c5a1a19ce0aeab1c8a4db3710f311a6f08cdc75adbaad9971ad0b96df7cf6dcd`.
- Distinct from Network Flow (`NETWORK_FLOW != INCIDENT_ALERT`): warm/radial/node-based
  vs cyan/directional/edge-based.

### license

`license_type = company_owned`. Original internal procedural asset; project-owned. No
third-party assets, references, or logos. No `TBD`/`UNKNOWN`.

### rights-review

Rights reviewed: original internal creation (`origin_type = original_internal`,
`reference_usage = none`). No third-party IP, trademark, or vendor logo. Company-owned,
cleared for production use.

### technical-review

512×512 RGBA8 PNG within the texture hard-max (`<= 4096`, recommended `<= 2048`). True
straight-alpha (partial > 0), no baked background. C01–C26 pass 26/26; verify-generated
deterministic (drift = 0). Node-centered runtime transform verified in unit, browser
(real WebGL2 / Apple M4 Max Metal), and a live simulation-originated `INCIDENT_OPENED`.

## Asset gate / budget

- Included set = **6** (4 buildings + Network Flow + Incident Alert), excluded 0,
  hard_errors 0. `build_id` = `ee6b2c899b58572b6b0ee4068b4f5d615c157140b96c1615f35ca5ffea91559a`
  (was `0633e0f8…` for 5).
- `verify-generated`: nondeterministic 0 / schema 0 / drift 0 / gate pass.
- `asset-production-gate`: **PASS 26/26**, 0 errors, 0 warnings.
- **C17 transfer** (critical-core): 83,773 B total (APP 6,000 + DB 5,329 + Cache 3,795 +
  LB 4,297 + NetworkFlow 2,089 + IncidentAlert 62,263) ≤ 8,388,608 B — headroom 8,304,835 B.
- **C18**: Incident critical texture 1,048,576 B ≤ 32 MiB; cumulative resident 6,291,456 B
  ≤ 64 MiB — headroom 60,817,408 B. Swap peak (old 5 + new 6 coexistence) 11,534,336 B ≤ 64 MiB.
  Sprite instance count does NOT multiply resident bytes (one shared TextureSource).
- Existing resources (4 buildings + `effect.network-flow.primary`, checksum `d4c2dd4e…`)
  UNCHANGED.

## Evidence

- **Unit (vitest):** `eventEffectMapping.test.ts` (6) + `eventDerivedEffectController.test.ts`
  (32, incl. 13 incident/target-node cases: mapping, node-centered transform, identity,
  dedup, distinct-type independence, unmapped INCIDENT_PHASE_CHANGED/RESOLVED, malformed
  skip, late skip, tick expiry, pending-dispose race, network-flow coexistence). Full suite
  **271 passed** (was 258).
- **Browser (Playwright, real WebGL2 / Apple M4 Max ANGLE Metal, SwiftShader FALSE):**
  `test:browser:event-derived` extended to 10 scenarios — `incident_spawn_render_primary`,
  `incident_expiry_removes_effect`, `network_flow_incident_coexistence` (both visible,
  DIFFERENT TextureSources, independent refcounts + lifetime), `multi_incident_shared_texture`
  (8 sprites, refCount 8, one texture). 0 console/page errors, 0 detached warnings, no
  context loss.
- **LIVE END-TO-END:** real stack; LB→APP built, app server DISABLED → the simulation
  incident evaluator opened a canonical `INCIDENT_OPENED{ incident: NO_HEALTHY_SERVER,
  target: lb-1, tick: 1 }` delivered over the real WebSocket to the browser (in-page tap,
  NOT injection). The incident-alert rendered node-centered on the LB (warm-hazard pixels
  0 → 1507, ~90×90 localized region over the building, which remained visible); after
  advancing past `tick + 6` the alert expired (warm pixels → 67, no re-spawn since
  `INCIDENT_PHASE_CHANGED` is unmapped). 0 console/page/WebGL errors.
- **Regression:** frontend lint/typecheck/build clean; vitest 271; asset-runtime /
  production-image / effect-preview PASS; visual-c 5/5 (buildings PRIMARY + visible, no
  leaks). Backend ruff PASS, pytest **193 passed** (15 integration cases infra-gated by
  PostgreSQL/Redis — did NOT execute), REQUEST_ROUTED/route **20**, incident sim **9**.

## Environment note

Live validation used an explicit IPv4 backend port + a temporary Vite proxy because a
Docker listener owned IPv6 `localhost:8000` in this environment. Classification:
`TEST_ENVIRONMENT_CONFIGURATION`, NOT a product bug. The live-E2E harness is
THROWAWAY / NOT_COMMITTED; evidence is captured in this record.

## Scope boundary

- Product-code changes limited to: mapping policy extension, `target-node` placement +
  transform in `EventDerivedEffectController`, runtime manifest registration
  (`PRODUCTION_EFFECT_ASSETS`), and tests. AssetManager core, ProductionImageAssetLoader,
  GameSocket protocol, backend, simulation, `REQUEST_ROUTED`, incident backend semantics,
  and the generator/validator are UNCHANGED.
- Non-blocking follow-up: the 62 KB incident PNG (large soft glow) could be size-optimized
  (`NON_BLOCKING_OPTIMIZATION_FOLLOW_UP`) — well within the C17 budget, not required.
- `PRODUCTION_EFFECT_CANDIDATE_006 = READY_FOR_DEVCTO_EFFECT_ASSET_REVIEW`; capacity NOT
  confirmed.
