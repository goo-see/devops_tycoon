# POLICY-C-FU-002 — EVENT_DERIVED Effect Lifecycle (Frontend Runtime)

Status: **EVENT_DERIVED = IMPLEMENTED_PENDING_DEVCTO_APPROVAL** ·
`POLICY-C-FU-002 = READY_FOR_DEVCTO_REVIEW`.

This is the first `event → effect` runtime. It consumes the canonical
`REQUEST_ROUTED` DomainEvent and renders the approved production effect resource
`effect.network-flow.primary` along the routed source→target edge, with a
deterministic simulation-time lifecycle. Frontend-only; no asset, simulation, or
backend change.

## Prerequisite

`REQUEST_ROUTED_EDGE_EVENT = COMPLETE_IN_DEV` (base dev `fe64211`). The simulation
emits one aggregated `REQUEST_ROUTED` per `(tick, source, target)` with
`detail = {source_node_id, target_node_id, count}`; the backend delivers it as an
`EventEnvelope` (`type`, `tick`, `target == target_node_id`, `payload = detail`).

## Mapping (explicit allowlist)

`src/game/effects/eventEffectMapping.ts` — an EXACT-MATCH allowlist with exactly one
entry:

| eventType | assetId | placement | durationTicks |
| --- | --- | --- | --- |
| `REQUEST_ROUTED` | `effect.network-flow.primary` | `source-to-target` | 6 |

No inference: no `effect.${type}` convention, no substring/`contains` match, no
category inference, no unknown-event fallback. Any non-allowlisted event → no effect.

## Contract & semantics

- **Authoritative frontend simulation clock:** `gameSessionStore.currentTick`
  (`Math.max` of snapshot / summary / event tick). No wall-clock is ever used for
  lifetime.
- **Delivery path:** `Simulation _route → REQUEST_ROUTED → EventEnvelope →
  GameSessionSocket → gameSessionStore (deduped by event_id) → GameCanvas bridge →
  GameScene → EventDerivedEffectController → AssetManager → ProductionImageAssetLoader
  → HTTP + SHA-256 → Texture → Sprite → effects layer → WebGL2`. No new WebSocket /
  backend / effect message; the generic domain-event path is reused.
- **Edge source:** the effect reads `payload.source_node_id` / `payload.target_node_id`
  directly — it NEVER infers endpoints from the connections topology. Topology is
  used only to resolve `nodeId → world position` (`GameScene.positionOf`).
- **Occurrence identity:** `request-routed:<tick>:<source>:<target>` (deterministic,
  never a UUID).
- **count:** `V1_NOT_USED_FOR_VISUAL_INTENSITY` — one event ⇒ one effect instance,
  whether count is 1 or 30,000. No count-based sprite/particle/opacity/size/duration
  scaling (deferred follow-up).
- **TTL:** `expiresAtTick = event.tick + durationTicks` (SIMULATION time).
  `durationTicks = 6`: `tick_ms = 200` at 1x ⇒ ≈1.2 s (0.6 s @2x, 0.3 s @4x) — an
  identical tick-count lifetime at every speed; only wall-clock differs. Frame-rate
  independent (expiry is decided by tick, not frames).
- **Late events:** an event whose `currentTick >= expiresAtTick` is dropped (no
  flash of historical effects). The bootstrap backlog is skipped by seeding the
  bridge watermark to the current cursor.
- **Placement:** anchor `(0.5,0.5)` at the edge midpoint; `rotation = atan2(dy,dx)`
  (source→target); `width = edge length`; fixed readable `height`. All visual
  constants live in one block in `EventDerivedEffectController.ts` (§25).

## AssetManager integration

- `AssetManager.acquire('effect.network-flow.primary')` only — never `fetch` /
  `Texture.from` / `Assets.load` directly. The effect is registered in the production
  runtime manifest (`PRODUCTION_EFFECT_ASSETS` / `buildProductionManifest`); the asset
  file, metadata, and checksum are UNCHANGED.
- **Ownership/refcount:** N concurrent effects ⇒ N sprites, N per-instance handles,
  ONE shared cached Texture (`refCountOf == N`). Sprite cleanup uses
  `destroy({texture:false, textureSource:false, children:true})` — the shared texture
  is the AssetManager's to own, never destroyed by an effect. Individual removal
  releases only that handle; other instances survive. Final release → refCount 0
  (AssetManager disposal policy; no conflict with the bitmap-lifetime fix, no double
  destroy).
- **PENDING → ACTIVE** lifecycle with a generation counter. Async acquire races are
  handled: if the occurrence expires, or the session resets, or the controller is
  disposed while a load is in flight, the resolved handle is released and no sprite is
  attached (no resurrection). Load failure keeps the registry clean and the renderer
  healthy (existing AssetManager fallback contract; no effect-specific loader).

## Lifecycle ownership

- The controller lives on the `GameScene` (owns Pixi + AssetManager + positions +
  the reserved `effects` layer). `GameCanvas` bridges the deduped store event stream
  and `currentTick` to `advanceEffects` / `handleDomainEvent` / `resetEffects`.
- **Subscription ownership:** one store subscription per active session (per
  GameCanvas mount); cleaned up on unmount. Session change → `resetEffects`. Scene
  destroy → `controller.dispose` (removes sprites, releases handles, invalidates
  pending). Re-enter → fresh state, one listener (verified by visual-c route
  round-trips: no socket/canvas leak).
- **No effect → simulation feedback.** The controller only reads events/tick; a
  render failure cannot affect routing, economy, health, incidents, or request
  results.

## Evidence

- **Unit (vitest):** `tests/game/effects/eventEffectMapping.test.ts` (4),
  `eventDerivedEffectController.test.ts` (21), `eventDerivedEffectDelivery.test.ts`
  (2) — mapping/allowlist, occurrence identity, dedup, different tick/edge
  independence, count-not-visual, deterministic placement, expiry, late-skip, bad
  payload skip, pause-freezes/ticks-consume lifetime, idempotent cleanup,
  shared-texture-safe sprite destroy, individual + final release, reset, dispose,
  and the three async-acquire races (expiry/reset/dispose). Full suite: **258
  passed** (was 231; +27).
- **Browser (Playwright, real WebGL2):** new `test:browser:event-derived` harness —
  `spawn_render_primary` (PRIMARY, visible edge frame), `expiry_removes_effect`,
  `pause_keeps_resume_expires`, `speed_invariant_lifetime` (1x vs 4x), 
  `multi_instance_shared_texture` (16 sprites, refCount 16, one texture),
  `cleanup_clean`. Pixel-readback evidence; 0 console/page errors, 0 detached
  warnings, no context loss.
- **Hardware:** validated on **Apple M4 Max — `ANGLE (Apple, ANGLE Metal Renderer:
  Apple M4 Max)`** (`PW_ANGLE=metal`), SwiftShader = FALSE. Default config uses
  SwiftShader for CI portability.
- **Regression:** frontend typecheck / lint / build clean; `test:browser:asset-runtime`,
  `production-image`, `effect-preview` PASS; **visual-c 5/5** against the live stack
  (buildings PRIMARY + visible, no errors, no socket/canvas leak). Python
  ruff/mypy/pytest **193** + REQUEST_ROUTED **14** pass. Asset gate **PASS 26/26**,
  verify-generated pass.

## Unchanged (immutability)

- `effect.network-flow.primary` source / metadata / checksum
  (`d4c2dd4e…`) / governance — UNCHANGED (only registered into the runtime manifest).
- Included set = **5**; `build_id 0633e0f8`; **C17 21,510 B**; **C18 5 MiB** —
  UNCHANGED. Sprite count does NOT multiply texture resident bytes (one shared
  texture).
- Simulation, backend, `REQUEST_ROUTED` contract, asset generator/validator —
  UNCHANGED.

## Scope boundary

- `EVENT_DERIVED` is **IMPLEMENTED_PENDING_DEVCTO_APPROVAL** — not `COMPLETE_IN_DEV`.
- Performance/concurrency: the 1/16-instance runs are `RUNTIME_SANITY_EVIDENCE` only;
  no sprite/particle/effect capacity is confirmed.
- Candidate **#006 (Incident Effect) = WAIT** until FU-002 is `COMPLETE_IN_DEV`. No
  #006 asset, no new asset, no atlas, no particle engine, no wall-clock TTL, no
  topology inference, no event-name→asset convention.
