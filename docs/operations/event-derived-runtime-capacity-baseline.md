# EVENT_DERIVED Runtime Capacity Baseline (MEASURED)

Status: **EVENT_DERIVED_RUNTIME_CAPACITY_BASELINE = READY_FOR_DEVCTO_REVIEW**.
Base dev `4200190`. Branch `infra/platform`. Benchmark/test/docs only — **zero product-code,
asset, backend, or simulation change**.

This is a **measurement baseline**, not a policy. It records the OBSERVED runtime cost of
event-derived effects on real hardware. **It deliberately declares NO performance target,
NO supported maximum, and NO budget.** Statements are facts: *MEASURED*, *OBSERVED*,
*ESTIMATED*.

## Methodology

- **Harness:** `frontend/tests/browser/event-derived-capacity/` (driver
  `capacity.spec.ts`, in-page `benchmark.ts`). Uses the **real** production runtime — real
  `EventDerivedEffectController`, real `AssetManager` + `ProductionImageAssetLoader`, the
  **real served production textures** (`effect.network-flow.primary`,
  `effect.incident-alert.primary`, checksum-verified), and a real Pixi **WebGL2** renderer.
  Only event generation + synthetic node/edge positions are test-owned. No product debug
  hook was added; metrics come from the controller's existing public surface
  (`handleEvent`/`advanceTo`/`activeCount`/`reset`), the AssetManager's `refCountOf`, and
  browser-standard APIs (rAF, `performance.memory`, requests).
- **Capacity vs live-E2E:** this is a CONTROLLED canonical event stream into the real
  effect runtime — it measures effect rendering/controller cost, **not** backend/WebSocket/
  simulation throughput. The durable live-E2E (`pnpm test:browser:event-derived-live`)
  remains the real-origin correctness proof and is unchanged + green.
- **Command:** `pnpm test:browser:event-derived-capacity` (local hardware:
  `PW_ANGLE=metal pnpm test:browser:event-derived-capacity`).
- **Frame measurement:** Pixi ticker stopped; `app.render()` driven once per `rAF`; frame
  interval = inter-rAF delta. Steady state holds the authoritative simulation tick constant
  so effects remain ACTIVE; expiry is triggered by `advanceTo(tick + durationTicks)` — never
  wall-clock, never a modified `durationTicks`.
- **Warm-up / measure:** 60 warm-up frames + **180** measured frames per repetition.
  (Deviates from the §42 reference 300 to keep the full 96-point local sweep inside one
  reproducible run; frame cadence was flat and 180 frames is ample for p50/p95/p99 at this
  cadence. Applied consistently to every point.)
- **Repeats:** 3 per steady-state point (all repetitions stored in the artifact; tables
  below report the per-point **median** across repeats).
- **Ladder (measurement points, NOT limits):** 0, 1, 4, 8, 16, 32, 64, 128.
- **Scenarios:** `network_only_distributed`, `incident_only_distributed`,
  `mixed_distributed` (~50/50), `incident_overlap` (alerts crowded into one small region).
- **Zero control** captured before AND after the sweep (§44).
- **Raw artifact (machine-readable):** `evidence/event-derived-capacity/baseline.json`
  (gitignored per repo convention — `/evidence/` is non-committed; numbers are recorded
  here). Contains every repetition, environment, and per-point metric.

## Environment (local hardware — the source of truth)

| Field | Value |
| --- | --- |
| git SHA | `4200190` (base); harness HEAD on `infra/platform` |
| Renderer | `ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)` |
| SwiftShader | FALSE |
| WebGL | WebGL2 |
| Viewport / DPR | 1280 × 720 / 1.0 |
| Headed/headless | headless (Playwright chromium) |
| hardwareConcurrency | 16 |
| preciseMemory | true (`--enable-precise-memory-info`) |
| GPU timer query ext | `EXT_disjoint_timer_query_webgl2` = AVAILABLE (see §GPU below) |

**CI numbers (software renderer) must NOT be mixed with these M4 Max/Metal numbers.** No CI
capacity job is added in this PR (optional smoke only; labelled `CI_BENCHMARK_HARNESS_SMOKE`,
not capacity data).

## Zero-effect control

- **Before:** observed FPS 60.2, frame p50 16.6 ms, p95 17.6 ms.
- **After:** observed FPS 59.9, frame p95 17.4 ms.
- Interpretation: the scene/renderer baseline is **display-refresh-bound (~60 Hz / ~16.7 ms)**
  and stable across the whole run. Frame intervals are therefore vsync-capped; see the
  interpretation note.

## First-visible latency (count = 1, incident-alert)

- `COLD_EFFECT_FIRST_VISIBLE_LATENCY_OBSERVED` = **274.8 ms** (fresh AssetManager: real HTTP
  fetch + decode + SHA-256 verify + first GPU upload + first frame).
- `WARM_EFFECT_FIRST_VISIBLE_LATENCY_OBSERVED` = **2.3 ms** (texture already cached).
- Not compared against any target (no cold/warm budget is confirmed here).

## Asset-fetch contract (§17)

Effect production-image HTTP requests: **2 after warm-up** (network + incident, once each);
**3 after the full 96-point sweep** (the extra 1 is the cold-latency probe's fresh
AssetManager fetching the incident PNG once). **No per-Sprite fetch** at any count —
`N` Sprites reuse the cached `TextureSource`.

## Summary — median across 3 repeats (MEASURED on M4 Max / Metal)

`fps` = observed; `p50/p95/p99` = frame interval ms; `p95÷0` = frame p95 relative to the
zero-effect baseline; `render p95` = CPU-side `app.render()` submit ms (NOT GPU time);
`adv p95` = `controller.advanceTo()` steady update ms; `feed` = ms to hand N events to the
controller; `→active` / `→clear` = rAF frames until all ACTIVE / all removed; `heap` = JS
heap used (MB, `JS_HEAP_USED_OBSERVED`); `tex` = unique production TextureSources.

### network_only_distributed
| count | fps | p50 | p95 | p99 | p95÷0 | render p95 | adv p95 | feed | →active | →clear | heap MB | tex | refN | status |
|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--|
| 0 | 60.2 | 16.6 | 17.4 | 17.7 | 0.99 | 0.2 | ~0 | 0.0 | 0 | 0 | 9.7 | 0 | 0 | MEASURED_STABLE |
| 1 | 59.9 | 16.7 | 17.3 | 17.7 | 0.98 | 0.2 | ~0 | 0.1 | 1 | 0 | 9.3 | 1 | 1 | MEASURED_STABLE |
| 4 | 59.9 | 16.7 | 17.4 | 17.6 | 0.99 | 0.2 | ~0 | 0.0 | 1 | 0 | 9.1 | 1 | 4 | MEASURED_STABLE |
| 8 | 59.9 | 16.7 | 17.4 | 17.6 | 0.99 | 0.2 | ~0 | 0.1 | 1 | 0 | 8.9 | 1 | 8 | MEASURED_STABLE |
| 16 | 59.9 | 16.7 | 17.5 | 17.7 | 0.99 | 0.2 | ~0 | 0.1 | 1 | 0 | 8.9 | 1 | 16 | MEASURED_STABLE |
| 32 | 59.9 | 16.7 | 17.4 | 17.6 | 0.99 | 0.2 | ~0 | 0.2 | 1 | 0 | 9.1 | 1 | 32 | MEASURED_STABLE |
| 64 | 59.9 | 16.7 | 17.1 | 17.5 | 0.97 | 0.2 | ~0 | 0.2 | 1 | 0 | 9.1 | 1 | 64 | MEASURED_STABLE |
| 128 | 59.9 | 16.7 | 17.5 | 17.7 | 0.99 | 0.3 | ~0 | 0.4 | 1 | 0 | 9.4 | 1 | 128 | MEASURED_STABLE |

### incident_only_distributed
| count | fps | p50 | p95 | p99 | p95÷0 | render p95 | feed | →active | →clear | heap MB | tex | refI | status |
|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--|
| 0 | 59.9 | 16.7 | 17.5 | 17.7 | 0.99 | 0.2 | 0.0 | 0 | 0 | 9.9 | 0 | 0 | MEASURED_STABLE |
| 1 | 59.9 | 16.7 | 17.4 | 17.7 | 0.99 | 0.2 | 0.0 | 1 | 0 | 9.8 | 1 | 1 | MEASURED_STABLE |
| 4 | 59.9 | 16.7 | 17.4 | 17.7 | 0.99 | 0.2 | 0.0 | 1 | 0 | 9.8 | 1 | 4 | MEASURED_STABLE |
| 8 | 59.9 | 16.7 | 17.4 | 17.7 | 0.99 | 0.2 | 0.0 | 1 | 0 | 8.8 | 1 | 8 | MEASURED_STABLE |
| 16 | 59.9 | 16.7 | 17.4 | 17.6 | 0.99 | 0.2 | 0.1 | 1 | 0 | 9.1 | 1 | 16 | MEASURED_STABLE |
| 32 | 59.9 | 16.7 | 17.4 | 17.6 | 0.99 | 0.2 | 0.1 | 1 | 0 | 9.2 | 1 | 32 | MEASURED_STABLE |
| 64 | 59.9 | 16.7 | 17.4 | 17.6 | 0.99 | 0.2 | 0.2 | 1 | 0 | 9.4 | 1 | 64 | MEASURED_STABLE |
| 128 | 59.9 | 16.7 | 17.4 | 17.7 | 0.99 | 0.2 | 0.2 | 1 | 0 | 9.3 | 1 | 128 | MEASURED_STABLE |

### mixed_distributed (≈50/50 network + incident)
| count | fps | p50 | p95 | p95÷0 | render p95 | feed | heap MB | tex | refN | refI | status |
|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--|
| 0 | 59.9 | 16.7 | 17.3 | 0.98 | 0.1 | 0.0 | 9.5 | 0 | 0 | 0 | MEASURED_STABLE |
| 4 | 59.9 | 16.7 | 17.4 | 0.99 | 0.1 | 0.0 | 9.6 | 2 | 2 | 2 | MEASURED_STABLE |
| 16 | 59.9 | 16.7 | 17.3 | 0.98 | 0.1 | 0.1 | 9.5 | 2 | 8 | 8 | MEASURED_STABLE |
| 32 | 59.9 | 16.7 | 17.6 | 1.00 | 0.1 | 0.1 | 9.6 | 2 | 16 | 16 | MEASURED_STABLE |
| 64 | 59.9 | 16.7 | 17.5 | 0.99 | 0.2 | 0.1 | 9.9 | 2 | 32 | 32 | MEASURED_STABLE |
| 128 | 59.9 | 16.7 | 17.4 | 0.99 | 0.1 | 0.3 | 10.0 | **2** | 64 | 64 | MEASURED_STABLE |

### incident_overlap (crowded single region — overdraw stress)
| count | fps | p50 | p95 | p95÷0 | render p95 | heap MB | tex | refI | status |
|--:|--:|--:|--:|--:|--:|--:|--:|--:|--|
| 0 | 59.9 | 16.7 | 17.4 | 0.99 | 0.1 | 9.9 | 0 | 0 | MEASURED_STABLE |
| 16 | 59.9 | 16.7 | 17.3 | 0.98 | 0.1 | 10.2 | 1 | 16 | MEASURED_STABLE |
| 32 | 59.9 | 16.7 | 17.5 | 0.99 | 0.1 | 10.4 | 1 | 32 | MEASURED_STABLE |
| 64 | 59.9 | 16.7 | 17.4 | 0.99 | 0.1 | 10.1 | 1 | 64 | MEASURED_STABLE |
| 128 | 59.9 | 16.7 | 17.6 | 1.00 | 0.1 | 10.2 | 1 | 128 | MEASURED_STABLE |

`OVERLAP_RENDER_STRESS_OBSERVED`: at equal Sprite count, measured `incident_overlap` frame
p95 and CPU render-submit were close to `incident_only_distributed` on this hardware (e.g.
128: overlap p95 17.6 ms vs distributed 17.4 ms; CPU render-submit p95 0.1 vs 0.2 ms).
Because frame cadence is vsync-capped and a valid GPU timer query was NOT_AVAILABLE, **the
current methodology did not resolve a meaningful difference between distributed and
overlapping Incident Alert rendering at 128 effects** — this is explicitly NOT a claim of
`NO_OVERDRAW_COST` and NOT an exact GPU overdraw measurement. Resolving overdraw cost would
require the proposed GPU-timing / uncapped-render follow-up.

## Spawn / cleanup bursts (§24/§25)

- **Spawn:** feeding 128 distinct occurrences to the controller took ≤ **0.4 ms**; all N
  reached ACTIVE within **1 rAF** after the texture was cached (`→active` = 1 at every
  count). `COLD` first texture load is the 274.8 ms one-time cost above.
- **Cleanup:** `CLEANUP_BURST_COST_OBSERVED` — expiring N effects via
  `advanceTo(tick+6)` removed all Sprites and released all handles **within the same update
  (→clear = 0 frames)** at every count; `refcountsZeroed` = true.

## Shared-texture & refcount contract (§16/§36) — verified at every count

- `network_only`: **1** TextureSource, network refcount == count.
- `incident_only` / `incident_overlap`: **1** TextureSource, incident refcount == count.
- `mixed`: **2** TextureSources (one per asset), refcounts == consumer split.
- `N` Sprites never produced `N` texture copies. (Asserted in the spec across all points.)

## JS heap & leak cycles (§26–28)

- `JS_HEAP_USED_OBSERVED` steady: **~9–10 MB** across the whole ladder; 128 effects showed
  no material heap increase over 0 effects (dominated by the renderer/bundle, not per-effect
  Sprites — expected, since textures are shared).
- **Leak cycle (32 effects × 20 cycles):** after every cycle `activeAfter = 0`,
  `spriteAfter = 0`, incident refcount `= 0`; heap ranged **8.6–8.8 MB** with no monotonic
  growth (first 8.8 → last 8.7 MB). **No persistent object/handle/Sprite growth observed.**
- **Leak cycle (64 effects × 20 cycles):** also run (64 was stable); same return-to-baseline
  correctness.
- Heap is not expected to return byte-for-byte (GC is non-deterministic); the leak signal is
  object/refcount growth, of which there was none.

## GPU timing (§29–31)

- `GPU_TEXTURE_BYTES_ESTIMATED` (canonical, resident, shared): Network Flow 1024×256×4 = **1
  MiB**; Incident Alert 512×512×4 = **1 MiB**. 1 vs 128 Sprites of a kind does NOT multiply
  the underlying texture estimate (one shared `TextureSource`). This is an ESTIMATE, not
  `VRAM_MEASURED`.
- `GPU_RENDER_TIME_OBSERVED`: **NOT_AVAILABLE.** `EXT_disjoint_timer_query_webgl2` is exposed,
  but a valid, non-disjoint, isolated per-frame GPU timing around Pixi's internal batched
  render pipeline could not be obtained without owning draw submission; per §31 it is
  recorded NOT_AVAILABLE rather than approximated. Frame interval is NOT renamed as GPU time.

## Context health (§32) & long tasks

- Every measured point: **0 WebGL errors, 0 context-lost, 0 page errors, 0 console errors,
  0 detached-source warnings.** No `RUNTIME_UNSTABLE_OBSERVED` point was reached within the
  0–128 ladder in any scenario.
- `LONG_TASK_OBSERVED`: NOT_INSTRUMENTED in this harness (optional per §41).

## Interpretation (facts only — §55)

- On **Apple M4 Max / ANGLE Metal, 1280×720, DPR 1**, from 0 to 128 active effects in all
  four scenarios (including overlap), `DISPLAY_REFRESH_CADENCE_MAINTAINED_WITHIN_MEASURED_LADDER`:
  **frame cadence remained at display refresh (~60 fps / ~17.4 ms)**; frame p95 stayed within
  **0.97–1.00×** the zero-effect baseline. Because the cadence is vsync-capped, this is NOT a
  claim of GPU headroom or that 128 is "comfortably" supported.
- `CPU_RENDER_SUBMIT_TIME_OBSERVED` (CPU-side `renderer.render()` invocation, NOT GPU time,
  NOT frame time, NOT total render cost) stayed ≤ **0.3 ms** through 128.
  `CONTROLLER_UPDATE_TIME_OBSERVED: BELOW_TIMER_RESOLUTION` — `advanceTo` did not resolve as
  a positive value at these counts (this is "unmeasurably small," NOT "zero cost" / "free").
- **The runtime did not reach a degraded or unstable point within the measured ladder on
  this hardware** (`NO_RUNTIME_INSTABILITY_OBSERVED_WITHIN_MEASURED_LADDER`). Therefore
  **no maximum is declared** (`PRODUCTION_EFFECT_CAPACITY_LIMIT: NOT_DEFINED`) — the sweep did
  not find one; absence of an observed knee is not evidence that 128 is a supported limit.
- **Caveat (important):** frame intervals are **vsync-capped**, so frame p95 cannot reveal
  spare headroom below saturation. The sensitive sub-saturation signals here are
  render-submit CPU time and controller cost, both sub-millisecond through 128. Extending
  the ladder (256+) or an uncapped/offscreen render loop to find the saturation knee is a
  possible follow-up — **not required** for this baseline and **not performed**.
- Example allowed statements: *"At 128 overlapping Incident Alert Sprites on M4 Max Metal,
  observed frame p95 was 17.6 ms (1.00× the 0-effect baseline) with no context loss."*

## What this track does NOT claim

No `EFFECT_CAPACITY_CONFIRMED`, no max sprite/effect count, no frame-time/overdraw budget,
no supported-N. No product optimization was made. Any optimization opportunity would be a
documented follow-up only. Asset state unchanged (included 6, `build_id ee6b2c89…`, C17
83,773 B, C18 6,291,456 B; verify-generated PASS, gate 26/26).

## Follow-ups (non-blocking, not started)

- Saturation sweep beyond 128 and/or an uncapped render loop to locate the frame knee on
  hardware (and separately on CI software renderer as its own dataset).
- Valid GPU timer-query instrumentation around an owned benchmark render pass.
- `LONG_TASK_OBSERVED` instrumentation; spawn/remove screenshot capture (cleanup is already
  verified structurally here and at the pixel level by the #006 live review).
