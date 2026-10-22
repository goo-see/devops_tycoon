# EVENT_DERIVED Production Envelope Policy — Architecture Decision

Status: **EVENT_DERIVED_PRODUCTION_ENVELOPE_POLICY = READY_FOR_DEVCTO_REVIEW**.
Base dev `ae1d9d3`. Branch `plan/program`. **Documentation only — zero product-code,
simulation, asset, Pixi, or branch-protection change. No implementation.** This selects an
*architecture*, not numbers; numeric values are explicitly deferred to game design.

**Decision: `ARCHITECTURAL_POLICY = HYBRID`** (soft gameplay topology envelope + simulation-truth-
preserving visual coalescing + a deterministic global visible-effect safety bound). Rationale
and the rejected alternatives are below.

## Current validated facts (inputs only — §3)

| | Fact |
| --- | --- |
| A | Node/edge counts are `UNBOUNDED_BY_CURRENT_CONTRACT` (domain `_add_node`/`_connect`, UI, config, schema). |
| B | `REPRESENTATIVE_WORKLOAD = UNDEFINED` (no canonical gameplay sizes in repo). |
| C | Network Flow steady state ≈ `6 × routed LB→APP edges` (6-tick TTL × per-tick routed edges). |
| D | Incident Alert workload = unique `INCIDENT_OPENED` occurrences within the last 6 ticks; `cooldown_general = 600` ⇒ ≤1 open per `(type,target)` per window (bursty-on-open). |
| E | Legal/reachable configurations can exceed 128 combined effects (observed 129 / 192 / 224 / 257). |
| F | M4 Max/Metal baseline measured **0..128 only**. |
| G | Baseline found **no** technical saturation point (vsync-capped frames; GPU timing NOT_AVAILABLE). |

**Boundary (§4/§26/§27):** 128 is only the largest measured baseline point — not a supported,
safe, desired, or gameplay maximum. 16-app / 32-edge were *analysis examples*, not limits.
">128 exceeds the measured baseline" does **not** mean ">128 is broken."

## Existing game-design evidence (§31 — used as input, not reinterpreted)

The project's own design already points at **visual bounding, not topology bounding**:

- **`POLICY-C-FU-003` is IMPLEMENTED** (`src/game/incidentModel.ts`): the persistent incident
  **status overlay** already dedupes by stable `(type,target)` key, sorts deterministically by
  `(phase-priority, type, target)` (never random), caps at `MAX_VISIBLE_INCIDENTS = 6`, and
  reports `overflowCount`. This is an **architectural precedent** for the Option-B/C discipline
  (visual representation bounded while truth is retained) — **not** a direct implementation to
  reuse: the status overlay is a different surface with a different lifecycle than an
  event-derived effect (TTL, per-occurrence spawn), so the shape transfers, the code does not.
- **`pixi-asset-pipeline.md`**: "Cull off-screen objects; **cap concurrent animations and
  particles**." — an explicit visual-concurrency-cap directive.
- **`decisions-required.md` / `gameplay-visual-mapping.md`**: request/connection flow is
  "**sampled/approximate**, rate scales with speed" and "a **visual** [approximation]" — i.e.
  visual truth is explicitly *not* 1:1 with events, by design.
- **`isometric-campus-spec.md`**: "Backend imposes **no spatial model**"; campus zones are a
  "**soft/tutorial-only** guide." — topology is intentionally sandbox; no hard spatial/topology
  limit is desired.

The event-derived **effects** (network-flow, incident-alert) currently do *not* follow this
discipline — they are 1:1 per occurrence with TTL amplification (6×), unlike the incident status
overlay that already coalesces. The policy is therefore largely **"extend the established
POLICY-C-FU-003 visual-bounding discipline to the event-derived effects,"** while keeping the
sandbox topology the design already intends.

## Problem statement

With topology unbounded (by design) and effects rendered 1:1-per-occurrence with a 6-tick TTL,
the number of simultaneous event-derived effects is formally unbounded and reaches 192–257 in
reachable configurations — above the measured baseline. We need an architecture that (1) keeps
simulation authoritative, (2) does not sacrifice sandbox freedom purely for renderer protection,
(3) yields an *absolute* renderer workload bound, and (4) produces a well-posed number to
benchmark later. No numbers are chosen here.

## Simulation-truth invariant (mandatory for B and C — §23)

Simulation truth is authoritative and **immutable** by any visual policy: request routing,
incident open/resolve, economy, score, health, and `REQUEST_ROUTED`/`INCIDENT_OPENED` emission
are never altered, dropped, delayed, or fed back from rendering. Visual truth may be
**coalesced/compressed** for readability and performance. `SIMULATION_FEEDBACK = FORBIDDEN`.
The simulation/event stream is authoritative and independent of rendering: visual
coalescing/overflow changes only what is *drawn*, never what the simulation **computes or
emits** — no DomainEvent is dropped, altered, reordered, or delayed because of a visual
decision (§24). This makes **no** durable event-log claim: the in-sim `EventLog` is a bounded
ring buffer (`max_size = 500`) and the backend event store is separate; the invariant is only
that visual overflow never affects the event pipeline, not that every historical event is
retained forever.

## Option A — `TOPOLOGY_BOUND_POLICY`

Bound the simulation/game topology itself (max nodes / nodes-by-type / connections / routed
LB→APP edges / LB degree). To be a *true* workload bound it must be **domain-authoritative**
(§6) — a frontend-only cap is not a product bound. Symbolically it bounds
`MAX_NETWORK_EFFECTS = 6 × max_routed_edges` and `MAX_INCIDENT_ALERT = 2A+2D+C+2L+1` via node
caps (§9).

- **Advantages:** deterministic simulation-size ceiling, simpler capacity planning / QA matrix.
- **Costs:** reduces sandbox freedom; changes gameplay/design semantics; needs session migration;
  risks an **arbitrary** limit (no game-design topology requirement exists — design explicitly
  wants "no spatial model"); couples future content to an infrastructure-derived number; needs a
  "limit reached" UX.
- **§29 disqualifier:** A as the *sole* solution is **rejected** — its only available rationale
  here is renderer protection, and the design explicitly wants sandbox topology. A hard topology
  limit must not be selected because the benchmark ended at 128 (§8).

## Option B — `EFFECT_VISUALIZATION_BOUND_POLICY`

Simulation/event generation unchanged; only the **visual representation** is bounded/coalesced.
Components (§11): per-edge network coalescing, per-target incident coalescing, a global visual
concurrency bound, and deterministic prioritization on overflow.

- **Network coalescing (§12/§13):** one active visual per edge; new `REQUEST_ROUTED` refreshes it
  (intensity/state) instead of adding a Sprite. Preserves direction + edge identity; **may**
  encode occurrence volume via intensity/state (a candidate visual encoding — no formula is
  fixed here); drops only *individual-tick* visual multiplicity. Removes the
  ~6× TTL amplification: `VISIBLE_NETWORK_FLOW ≤ active routed edges` (not `× 6`).
- **Incident coalescing (§14):** recommend **one alert visual per `(type,target)`** (option 14-B)
  — it matches the event's own occurrence identity and the shipped POLICY-C-FU-003 overlay key;
  different types on one node stay distinct (information preserved); only repeat opens of the
  same `(type,target)` within a window coalesce (already rare due to cooldown).
- **Advantages:** simulation freedom preserved; no topology/gameplay restriction; renderer
  workload controlled independently; sim scaling decoupled from visual scaling; high density
  becomes clearer (§25).
- **Costs:** visual events no longer 1:1 with DomainEvents; new coalescing/priority semantics;
  larger test matrix; players don't see every occurrence individually.
- **§19/§35 disqualifier:** coalescing **alone** does **not** bound the renderer while topology is
  unbounded (one-per-edge of unbounded edges is still unbounded). B is acceptable **only** if it
  includes a **`GLOBAL_VISUAL_CONCURRENCY_BOUND`** (the only mechanism giving an absolute bound).

## Option C — `HYBRID_POLICY` (§20/§22)

A concrete composition (not "do both somehow"):

1. **Soft gameplay topology envelope** — a `DESIGN_EXPECTED_TOPOLOGY_ENVELOPE` for QA /
   performance / scenario / UX planning (tutorial/zone-guided), **not** a hard domain limit
   (`HARD_DOMAIN_TOPOLOGY_LIMIT = NO`). It guides without rejecting commands (§21).
2. **Visual coalescing** — network per-edge + incident per-`(type,target)` as in Option B, so TTL
   and event frequency do not multiply Sprite count.
3. **Global visible-effect safety bound** — a deterministic maximum number of simultaneous
   event-derived visual instances (the shipped `MAX_VISIBLE_INCIDENTS` pattern, generalized),
   containing pathological / future configurations.
4. **Overflow = visual-only policy** — coalesce → prioritize → represent-as-overflow, matching
   POLICY-C-FU-003's `visible + overflowCount`. Never drop a DomainEvent, never touch simulation.

## Comparison matrix (§28 — qualitative; ↑ = higher-is-better, ↓ = lower-is-better)

| Criterion (direction) | A Topology | B Visual | C Hybrid |
| --- | --- | --- | --- |
| Simulation semantic impact ↓ | **HIGH** (changes domain validity) | LOW (none) | LOW (none) |
| Gameplay freedom ↑ | LOW (restricts sandbox) | HIGH | HIGH |
| Visual readability ↑ | LOW (blunt; fewer only via caps) | HIGH (coalescing) | HIGH |
| Renderer-bound strength ↑ | MED (indirect, per-config) | HIGH *iff* global bound (else LOW, §19) | **HIGH** (explicit global bound) |
| Determinism ↑ | HIGH | HIGH (det. priority) | HIGH |
| Implementation complexity ↓ | MED | HIGH | HIGH (precedent lowers it) |
| Testing complexity ↓ | LOW–MED | HIGH | HIGH |
| Future scalability ↑ | LOW (couples sim↔renderer) | HIGH (decoupled) | HIGH |
| Backward compatibility ↑ | LOW (rejects valid topologies/sessions) | HIGH | HIGH |
| Debuggability ↑ | HIGH (fewer entities) | MED (visual≠1:1; event stream unaffected by visuals) | MED |
| Failure containment ↑ | LOW (no renderer safety for allowed configs) | HIGH | **HIGH** |
| Derive a performance target ↑ | MED (incident coeffs fuzzy) | HIGH | **HIGH** (global visible bound *is* the target) |

Every score is explained in the option sections. Net: **A is dominated** (restricts the sandbox
the design wants, couples simulation to renderer, no gameplay basis → §29). **B is strong but**,
framed as "visualization only," understates the useful soft topology envelope and must add a
global bound anyway (§19). **C captures the full, design-aligned architecture** and yields the
cleanest performance target (a single global visible-effect bound is exactly the number to
benchmark).

## Selected architecture — `HYBRID` (§32/§34)

- `EVENT_DERIVED_PRODUCTION_ENVELOPE_POLICY = ARCHITECTURE_SELECTED`
- `ARCHITECTURAL_POLICY = HYBRID`
- `GAMEPLAY_TOPOLOGY_ENVELOPE = TBD` (product/game-design defined; soft)
- `HARD_DOMAIN_TOPOLOGY_LIMIT = NO` (design: backend has no spatial model; sandbox preserved)
- `NETWORK_VISUAL_COALESCING = RECOMMENDED` — one active visual per LB→APP edge; new
  `REQUEST_ROUTED` refreshes it (direction + edge preserved; volume → intensity).
- `INCIDENT_VISUAL_COALESCING = RECOMMENDED` — one alert visual per `(type,target)` (aligns with
  occurrence identity + the shipped POLICY-C-FU-003 overlay key; distinct types on a node stay
  distinct).
- `GLOBAL_VISIBLE_EFFECT_SAFETY_BOUND = REQUIRED` — deterministic max simultaneous event-derived
  visual instances (generalize `MAX_VISIBLE_INCIDENTS`). This is the absolute renderer bound.
- `OVERFLOW_BEHAVIOR = VISUAL_ONLY_PRIORITIZE_THEN_OVERFLOW` — deterministic priority
  (candidate dimensions, §16: effect class, recency, severity, on-screen visibility, unique-target
  coverage), **never random eviction**; represent the remainder as an overflow indicator. Formula
  deferred (insufficient product semantics to fix it now).
- `SIMULATION_FEEDBACK = FORBIDDEN`.

**Why selected:** it is the only option that simultaneously preserves simulation truth and the
design's intended sandbox topology, directly extends an **already-shipped** project pattern
(POLICY-C-FU-003) and explicit design directives (cap particles; sampled/approximate flow),
gives an **absolute** renderer bound (which B-alone lacks and A achieves only by restricting
gameplay), and produces a single, well-posed number to benchmark.

**Rejected as the *sole* architecture (neither is invalid — both remain viable components):**
A (sole) — no gameplay basis for a hard topology limit; renderer-protection-only is disqualifying
(§29); would reject valid sandbox play. A hard topology limit may still be introduced **later**
for a genuine gameplay/design reason. B (sole) — would be acceptable *with* a global bound, but is
subsumed by C, which additionally carries the soft design envelope the project already uses;
naming it "B" would misrepresent the topology side. B's mechanisms (coalescing + global bound)
are retained inside C.

## Unresolved numeric inputs (§30 — REQUIRES_GAME_DESIGN_INPUT)

- `NUMERIC_PRODUCT_ENVELOPE = REQUIRES_GAME_DESIGN_INPUT` — the soft topology envelope and the
  global visible-effect bound value are **not** chosen here (no product basis exists; inventing a
  number from the 128 benchmark is forbidden, §8/§26).
- The overflow priority formula is likewise deferred until product/severity semantics are fixed.

## Downstream sequencing (§38/§39)

Required order: **architecture (this doc) → numeric intended workload (game design) → derive
target visible-effect range → benchmark that range → saturation sweep if needed → performance
budget → implementation.** Do not invert.

- `EVENT_DERIVED_SATURATION_SWEEP = STILL_DEFERRED` → becomes `JUSTIFIED_AFTER_NUMERIC_ENVELOPE`
  once the global visible-effect bound value is chosen (that bound defines the exact range to
  sweep, replacing the arbitrary 256/512/1024 problem). Nuance (§32): a full sweep is **not**
  guaranteed — if the chosen numeric target falls entirely inside the already-validated 0..128
  range, a **targeted confirmation** at that target may suffice instead of a new sweep.
- `EVENT_DERIVED_LIVE_E2E_REQUIRED_CHECK_DECISION = DEFERRED_PENDING_NATURAL_STABILITY_EVIDENCE`
  (§37) — 1 natural post-fix green run recorded (dev-push); do not manufacture more or use
  `--repeat-each` diagnostics as natural evidence.

## Canonical tokens (§43)

```
EVENT_DERIVED_PRODUCTION_ENVELOPE_POLICY: ARCHITECTURE_SELECTED (READY_FOR_DEVCTO_REVIEW)
ARCHITECTURAL_POLICY:                     HYBRID
HARD_DOMAIN_TOPOLOGY_LIMIT:               NO
GAMEPLAY_TOPOLOGY_ENVELOPE:               TBD (soft, game-design defined)
NETWORK_VISUAL_COALESCING:                RECOMMENDED (per-edge refresh)
INCIDENT_VISUAL_COALESCING:               RECOMMENDED (per type,target)
GLOBAL_VISIBLE_EFFECT_SAFETY_BOUND:       REQUIRED
OVERFLOW_BEHAVIOR:                        VISUAL_ONLY_PRIORITIZE_THEN_OVERFLOW (no numeric value)
SIMULATION_FEEDBACK:                      FORBIDDEN
PRODUCT_WORKLOAD_BOUND:                   NOT_DEFINED (numeric)
NUMERIC_PRODUCT_ENVELOPE:                 REQUIRES_GAME_DESIGN_INPUT
PRODUCTION_EFFECT_CAPACITY_LIMIT:         NOT_DEFINED
EVENT_DERIVED_SATURATION_SWEEP:           STILL_DEFERRED (→ JUSTIFIED_AFTER_NUMERIC_ENVELOPE)
EVENT_DERIVED_LIVE_E2E_REQUIRED_CHECK_DECISION: DEFERRED_PENDING_NATURAL_STABILITY_EVIDENCE
```

## Asset state (§40) — unchanged

included **6**, `build_id ee6b2c89…`, asset-production-gate **26/26**. No simulation / routing /
incident / effect-controller / Pixi / branch-protection change — documentation only.
