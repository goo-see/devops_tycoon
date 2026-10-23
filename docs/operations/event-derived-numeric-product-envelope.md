# EVENT_DERIVED Numeric Product Envelope — Game-Design Input Required

Status: **EVENT_DERIVED_NUMERIC_PRODUCT_ENVELOPE = BLOCKED_ON_GAME_DESIGN_INPUT**.
Base dev `4299287`. Branch `plan/program`. **Documentation only — no implementation, no
simulation/runtime/asset/Pixi/branch-protection change.** No numbers are invented: the repo
explicitly defers topology scale, so the numeric envelope cannot be `DEFINED` here (§6/§30/§31).
This document supplies (1) the evidence inventory, (2) the parametric framework that computes the
envelope the moment game design provides inputs, and (3) a concise decision sheet.

## Outcome in one line

The selected `HYBRID` architecture needs an *intended* topology envelope (edges / node counts) to
produce numeric visible-workload figures and a candidate `GLOBAL_VISIBLE_EFFECT_SAFETY_BOUND`
range. **The game-design docs mark all such numbers `TBD` (playtest-determined).** → BLOCKED,
with a decision sheet below. One architecture-level result *is* already determinable and topology-
independent: **visual coalescing removes the 6× Network-Flow TTL amplification** (see §Finding).

## Design evidence inventory & classification (§3/§4)

| Source | Content | Classification | Usable as product number? |
| --- | --- | --- | --- |
| `master-plan §4.7` growth stages | Stage 1 "Single App, SQLite"; Stage 2 "**App×N**, PostgreSQL, LB, Redis"; Stage 3 cache/replicas; 4 autoscale/shard; 5 multi-region. Tech is qualitative; sizes/success all **`TBD`**. | `CANONICAL_GAME_DESIGN` (qualitative only) | **No** — `N` unspecified; no counts. |
| `master-plan §4.x` tutorial steps 6–7 | "App **2대+** 가동", then "Load Balancer 도입". | `CANONICAL_GAME_DESIGN` | Only a **floor** (≥2 app, ≥1 LB), not an envelope. |
| `master-plan` org size per stage | 1 / 2–5 / 6–20 / 21–100 / 100+ **people**. | `PRODUCT_EXAMPLE` | **No** — team size, not node/topology count. |
| `master-plan GD-005`, line 187 | "자원 초기값·변화 계수 = **TBD** (플레이테스트 기반 확정)". | `CANONICAL_GAME_DESIGN` | Explicitly defers the numbers. |
| `events/*`, `technology-trigger-matrix` | Incident triggers/thresholds (qualitative). | `CANONICAL_GAME_DESIGN` | Informs incident *eligibility*, not counts. |
| `simulation/config/defaults.py` | `app_server_cost_per_tick 0.5`, `db 0.8`, `cache 0.3`; no starting cash / node price. | `TECHNICAL_TEST_ONLY` (balance placeholders) | **No** — no economy ceiling on topology. |
| `visualPrC.spec.ts` "54 nodes total" | 26 app + 14 redis + 14 postgres canvas stress. | `TECHNICAL_TEST_ONLY` | **No** (§4) — a renderer fixture, not design. |
| Capacity baseline 0..128, workload examples (129/192/257) | Measurement ladder + reachable examples. | `PERFORMANCE_SYNTHETIC` | **No** — analysis, not product intent. |

**Conclusion:** no `CANONICAL_GAME_DESIGN` or `PRODUCT_EXAMPLE` source provides numeric topology
*sizes*. Topology scale is intentionally `TBD` (sandbox + playtest-balanced). Inventing EARLY/MID/
LATE/HIGH_END counts from the 128 benchmark or the 54-node fixture is forbidden (§8/§30).

## Parametric framework (computes the envelope once inputs exist — §9–§17)

Let, per gameplay stage: `E` = distinct **actively routed LB→APP edges** (the Network-Flow
driver — not total nodes/edges, §10); `A/D/C/L` = app / database / cache / load-balancer counts.

- **Current Network visible** (`§11`): `CURRENT_NETWORK_VISIBLE ≈ 6 × E` (6-tick TTL × per-tick
  routed edges — occurrence identity includes tick).
- **Coalesced Network visible** (`§12`, recommended, not implemented):
  `COALESCED_NETWORK_VISIBLE ≤ E` (one refresh-in-place visual per actively routed edge).
- **Incident visible** (`§14/§15`): intended = unique `(type,target)` with an open incident in the
  last 6 ticks; contract worst case `≤ 2A + 2D + C + 2L + 1` (per the workload-envelope doc).
  `COALESCED_INCIDENT_VISIBLE` (one visual per `(type,target)`) ≤ that bound; intended gameplay is
  typically far below the worst case (incidents are bursty-on-open, cooldown 600).
- **Combined** (`§17`): `COALESCED_EVENT_DERIVED_VISIBLE = COALESCED_NETWORK_VISIBLE +
  COALESCED_INCIDENT_VISIBLE`. Separate `NORMAL` vs `BURST` (§18): incident opens and topology
  changes can spike the instantaneous count above steady state.

### Finding — topology-independent, already determinable

For **any** `E`, coalescing changes `6 × E → ≤ E`: a **6× reduction** of Network-Flow visual
workload, because most of the current amplification comes from TTL retention of repeated same-edge
occurrences, **not** from topology. This is the strongest single input to the eventual safety
bound and holds regardless of the (still-TBD) intended `E`.

### Illustrative only (NOT a product envelope — numbers are placeholders)

To show the *shape* of the reduction (explicitly non-binding; `E` values are hypotheticals, not
decisions):

| Hypothetical `E` | Current `6×E` | Coalesced `≤E` | Reduction |
| --- | --- | --- | --- |
| 3 | 18 | 3 | 6× |
| 8 | 48 | 8 | 6× |
| 32 | 192 | 32 | 6× |

These rows are **not** EARLY/MID/LATE values — they are the formula illustrated. The real stage
`E` values are `BLOCKED_ON_GAME_DESIGN_INPUT`.

## Baseline comparison & saturation (deferred until inputs — §22/§23)

Once `E_intended` and the intended incident density exist, `COALESCED_COMBINED` is computable and
classified against the measured `0..128` baseline as `FULLY_INSIDE` / `REACHES_EDGE` / `EXCEEDS`.
Only then (§23): if the candidate `GLOBAL_VISIBLE_EFFECT_SAFETY_BOUND` range sits inside `0..128`,
prefer a **targeted confirmation**; if it extends above 128, derive the exact next ladder *from the
product range* (e.g. a ~160 target → measure through ~192, justified) — never auto-`256/512/1024`.
`GLOBAL_VISIBLE_EFFECT_SAFETY_BOUND ≠ PRODUCTION_EFFECT_CAPACITY_LIMIT` (§24): the former is a
product visual policy, the latter a measured technical capacity — not the same number.

## Invariants carried forward

- `SIMULATION_FEEDBACK = FORBIDDEN` (§27): any visual bound/coalescing/overflow never alters
  `REQUEST_ROUTED`, `INCIDENT_OPENED`, routing, incidents, economy, score, or simulation state.
- Sandbox (§28): topology stays `UNBOUNDED_BY_CURRENT_CONTRACT`; configurations beyond the
  intended envelope are `SANDBOX_BEST_EFFORT_VISUALIZATION`, **not** unsupported simulation.
- Safety bound must sit **above** intended normal+burst workload (§19) with **explicit** headroom
  rationale (§21) — no silent ×1.5/×2 multiplier; overflow in intended play should be
  `RARE/EXCEPTIONAL` (§25), else the bound or the coalescing model is wrong.

## `GAME_DESIGN_DECISION_REQUIRED` (decision sheet — §6/§7/§31; not self-answered)

Minimal product/game-design inputs needed to unblock. (Topology bounds are **envelopes**, not hard
limits — `HARD_DOMAIN_TOPOLOGY_LIMIT = NO`, §8.)

| # | Question (answer per stage where noted) | Needed for |
| --- | --- | --- |
| 1 | Intended **EARLY** topology (LB / APP / Cache / DB)? | topology envelope |
| 2 | Intended **MID** topology? | topology envelope |
| 3 | Intended **LATE** topology? | topology envelope |
| 4 | Intended **HIGH_END** topology (supported, not pathological)? | topology envelope |
| 5 | May sandbox/free-play **exceed** that envelope? (expected: yes) | sandbox semantics |
| 6 | Expected **Load Balancer count** in late/high-end play? | `L`, routed edges |
| 7 | Expected **APP servers per LB**? | `A`, routed edges |
| 8 | Expected **distinct actively-routed LB→APP edges** `E` at high-end? | `COALESCED_NETWORK` |
| 9 | Should **all** routed edges be visually represented simultaneously? | coalescing target |
| 10 | Max board visual density before flows should summarize/coalesce? | coalescing + bound |
| 11 | When Network Flow vs Incident Alert compete for visual slots, which is preserved? | overflow priority |
| 12 | Must **severe** incidents stay individually visible even at the safety bound? | overflow priority |

Answers to 11–12 become `OVERFLOW_PRIORITY_REQUIREMENTS` (§26) — **not** a final score formula.

## Required output table (to be filled by game design — §29)

| Stage | Topology source | LB | APP | Cache | DB | Active routed edges `E` | Current net visuals `6E` | Coalesced net `≤E` | Expected incident visuals | Combined coalesced | Classification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| EARLY | **TBD** | ? | ? | ? | ? | ? | — | — | ? | ? | BLOCKED |
| MID | **TBD** | ? | ? | ? | ? | ? | — | — | ? | ? | BLOCKED |
| LATE | **TBD** | ? | ? | ? | ? | ? | — | — | ? | ? | BLOCKED |
| HIGH_END_INTENDED | **TBD** | ? | ? | ? | ? | ? | — | — | ? | ? | BLOCKED |
| SANDBOX_EXAMPLE | best-effort | n/a | n/a | n/a | n/a | unbounded | unbounded | ≤E | unbounded | safety-bounded | best-effort |

Only the tutorial **floor** is known from design (≥2 APP, ≥1 LB); it is a minimum, not an envelope.

## Decision tokens (§30)

```
EVENT_DERIVED_NUMERIC_PRODUCT_ENVELOPE:        BLOCKED_ON_GAME_DESIGN_INPUT
GAMEPLAY_TOPOLOGY_ENVELOPE:                    BLOCKED_ON_GAME_DESIGN_INPUT
ROUTED_EDGE_ENVELOPE:                          BLOCKED_ON_GAME_DESIGN_INPUT
COALESCED_VISIBLE_WORKLOAD_ENVELOPE:           BLOCKED (parametric model DEFINED; numbers blocked)
GLOBAL_VISIBLE_EFFECT_SAFETY_BOUND_CANDIDATE:  BLOCKED_ON_GAME_DESIGN_INPUT
NETWORK_COALESCING_REDUCTION:                  DEFINED (6× → ≤1×, topology-independent)
PRODUCT_WORKLOAD_BOUND:                        NOT_DEFINED
PRODUCTION_EFFECT_CAPACITY_LIMIT:              NOT_DEFINED
EVENT_DERIVED_SATURATION_SWEEP:                STILL_DEFERRED (pending numeric envelope)
EVENT_DERIVED_LIVE_E2E_REQUIRED_CHECK_DECISION: DEFERRED_PENDING_NATURAL_STABILITY_EVIDENCE
```

## Required-check observation (§33) — not manufactured

Branch protection unchanged (`event-derived-live-e2e` remains NON-REQUIRED). Natural post-Pixi-fix
green runs observed from ordinary activity (PR/promotion CI, not `--repeat-each` diagnostics):
small (on the order of a few). No runs were triggered to inflate the count; the required-check
decision stays `DEFERRED_PENDING_NATURAL_STABILITY_EVIDENCE`.

## Asset state (§34) — unchanged

included **6**, `build_id ee6b2c89…`, Pixi **8.21.0**, asset-production-gate **26/26**. No product
change — documentation only.
