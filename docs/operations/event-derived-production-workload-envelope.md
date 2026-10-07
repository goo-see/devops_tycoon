# EVENT_DERIVED Production Workload Envelope (contract-derived)

Status: **EVENT_DERIVED_PRODUCTION_WORKLOAD_ENVELOPE = READY_FOR_DEVCTO_REVIEW**.
Base dev `1a6818c`. Branch `plan/program`. **Analysis/documentation only — zero product-code,
asset, backend, or simulation change.** This derives the effect workload that *current*
gameplay contracts can generate, to inform (not decide) a future saturation/capacity policy.
It introduces **no** limit, budget, or runtime clamp.

## Authoritative sources examined

| Concern | Source |
| --- | --- |
| Node creation / kinds / validation | `simulation/commands.py::_add_node`, `_ALLOWED_EDGES`, `_connect` |
| Initial topology | `simulation/factory.py::new_state` (empty; built by player commands) |
| Routing / REQUEST_ROUTED emission | `simulation/engine.py::_route`, `_process_tick` |
| LB distribution (which edges route) | `simulation/requests/router.py::distribute` / `available_targets` |
| Servers behind an LB | `simulation/state.py::app_servers_behind` / `targets_of` |
| Effect mapping / TTL / occurrence window | `frontend/src/game/effects/eventEffectMapping.ts`, `EventDerivedEffectController.ts` |
| Incident types / rules / open uniqueness | `simulation/incidents/{models,rules,evaluator}.py` |
| UI node creation | `frontend/src/components/commands/NodeInspector.tsx` |
| Config limits | `simulation/config/defaults.py`, `backend/config.py` |

## Topology constraints (§4/§5)

- **Node kinds:** `load_balancer`, `app_server`, `redis` (cache), `postgresql` (database)
  (`backend/api/schemas/commands.py` `NodeKind`).
- **Initial state is EMPTY** — every node/edge is created by player `ADD_NODE` / `CONNECT`
  commands (`factory.py`).
- **Allowed directed edges** (`_ALLOWED_EDGES`): `load_balancer→app_server`,
  `app_server→cache`, `app_server→database`, `cache→database`. `CONNECT` rejects any other
  pair (`connection_not_allowed`) and duplicates (`already_connected`); self-edges are
  impossible (nodes are distinct kinds). Edges are **directed**.
- **Node/edge COUNT limits:** **NONE.** `ADD_NODE` rejects only empty/duplicate id and
  unknown kind; `CONNECT` rejects only disallowed pair / duplicate. No per-kind cap, no total
  cap in the domain, in config, or in the backend command schema.
- **UI vs domain (§5):** the in-app node creator (`NodeInspector.tsx`) disables its button
  only when the id field is empty/busy — **no UI count limit either**. So UI and domain agree:
  node/edge counts are **`UNBOUNDED_BY_CURRENT_CONTRACT`**.

## REQUEST_ROUTED contract & exact effect window (§6/§7)

- **Emission (`_route`):** REQUEST_ROUTED is emitted **only on the Load-Balancer path** —
  for each enabled LB, `distribute()` splits that LB's share across its **available**
  (enabled, non-Down) app servers behind it, and an edge `(lb_id, app_id, count)` is emitted
  **iff that server received `count ≥ 1` this tick**. The no-LB direct branch emits **no**
  REQUEST_ROUTED. So only `load_balancer→app_server` edges produce network-flow effects (§9).
- **Aggregation:** exactly **one** REQUEST_ROUTED per `(tick, source, target)` routed edge.
- **Occurrence identity:** `request-routed:<tick>:<source>:<target>`.
- **Exact active window (verified in `EventDerivedEffectController`):** an occurrence
  spawned at tick `T` sets `expiresAtTick = T + 6` and is removed when
  `currentTick ≥ T + 6`. It is therefore **ACTIVE while `currentTick ∈ {T, T+1, …, T+5}` — a
  6-tick inclusive window.** A single continuously-routed edge thus retains **at most 6**
  simultaneous network-flow effects (occurrences from the last 6 ticks).

## Network Flow formula (§8) — verified

```
routed_edges(tick)  = Σ over enabled LBs of  min(LB_share, available_app_servers_behind_LB)
                    = (under sufficient traffic) total enabled-LB→available-APP edges
ACTIVE_NETWORK_FLOW ≤ Σ over the last 6 ticks of distinct routed edges
                    ≤ 6 × max_routed_edges_per_tick          (steady traffic, upper bound)
```

Under steady traffic where every LB→APP edge routes every tick, **ACTIVE_NETWORK_FLOW =
6 × E**, where `E` = number of enabled-LB→available-APP edges.

- **Traffic volume is NOT the effect-count dimension (§11):** 30,000 requests on one edge
  still yield **one** REQUEST_ROUTED/tick (it only raises `detail.count`). Volume matters
  only in that a tiny `share < servers` routes to fewer servers (`min(share, servers)`);
  once `share ≥ servers`, all edges route.
- **Retry (§12):** `generated = base + pending_retries` (`_process_tick`). Retries increase
  the distributed volume — they can push `share` above `servers` to activate more edges (up
  to the `servers_behind_LB` cap) but **never create a second REQUEST_ROUTED for the same
  `(tick, source, target)`** (per-tick-per-edge aggregation) and do not add new edges.
- **`E` is `UNBOUNDED_BY_CURRENT_CONTRACT`** (LB and APP counts are unbounded) ⇒ the Network
  Flow effect count is **unbounded**.

## Incident contract (§14–§19)

Incident types (`simulation/incidents/models.py::IncidentType`) and their target node (from
`rules.py::collect_signals`):

| Incident type | Target | Cardinality |
| --- | --- | --- |
| `APP_CPU_OVERLOAD` | each app_server | per app |
| `APP_MEM_SATURATION` | each app_server | per app |
| `DB_CONNECTION_POOL_EXHAUSTION` | each database | per db |
| `DB_CPU_SATURATION` | each database | per db |
| `CACHE_MISS_SPIKE` | each enabled cache | per cache |
| `LB_IMBALANCE` | each load_balancer | per lb |
| `NO_HEALTHY_SERVER` | each load_balancer | per lb |
| `REQUEST_TIMEOUT` | `"system"` | **singleton** |

- **Open uniqueness (§15):** the incident book is keyed by `(type, target)`
  (`incident_key`). `_maybe_open` fires **only** when `book.active.get(key) is None` **and**
  `tick ≥ cooldown_until[key]`. So **at most one active incident per `(type, target)`**, and
  after it recovers a cooldown blocks re-arming. ⇒ a given `(type, target)` emits
  INCIDENT_OPENED **once per incident lifecycle**, not per tick. **This materially bounds the
  Incident Alert *production rate*** — alerts are bursty-on-open, not sustained.
- **Incident Alert window (§16):** spawns only on INCIDENT_OPENED, TTL 6 ticks (identical
  window math to above), independent of the incident's full active duration.
- **Same node, multiple types (§18):** legal — e.g. `APP_CPU_OVERLOAD` and
  `APP_MEM_SATURATION` can open on the same app_server in the same tick (distinct keys).
  **Not** "one alert per node."
- **Cooldown / reopen (§22):** `cooldown_general = 600 ticks`
  (`simulation/config/defaults.py`; `cooldown_rare = 3000`). After a `(type,target)` recovers,
  re-arming is blocked for 600 ticks — **far larger than the 6-tick effect window**. Therefore
  within **any** 6-tick window a given `(type,target)` can open **at most once**; it cannot
  recover-and-reopen inside the window. This makes the per-window upper bound below exact in
  that sense (each key contributes ≤ 1 opening per window).

### Incident Alert formula (§17/§19/§21) — symbols expanded

Let the current topology have `A` = app_server count, `D` = database (postgresql) count,
`C` = enabled cache (redis) count, `L` = load_balancer count. The **general** (exact) form is:

```
ACTIVE_INCIDENT_ALERT(currentTick C)
  = # unique INCIDENT_OPENED occurrences whose open tick T ∈ {C-5 … C}
```

The **contract upper bound** (max distinct `(type,target)` that can be open within one 6-tick
window) expands to `2·A + 2·D + 1·C + 2·L + 1`, where each coefficient maps to specific
`IncidentType`s targeting that node kind (`simulation/incidents/rules.py`):

| Term | IncidentType(s) | Target node kind |
| --- | --- | --- |
| `2·A` | `APP_CPU_OVERLOAD`, `APP_MEM_SATURATION` | each app_server |
| `2·D` | `DB_CONNECTION_POOL_EXHAUSTION`, `DB_CPU_SATURATION` | each database |
| `1·C` | `CACHE_MISS_SPIKE` | each enabled cache |
| `2·L` | `LB_IMBALANCE`, `NO_HEALTHY_SERVER` | each load_balancer |
| `+1` | `REQUEST_TIMEOUT` | the singleton aggregate target `"system"` (§20) — a literal non-node target id, not per-node |

Because `A/D/C/L` are themselves unbounded (no node cap), this upper bound is
**`UNBOUNDED_BY_CURRENT_CONTRACT`** (dependency: node counts). The expression is a
**contract upper bound**, not a steady-state count — real openings depend on how many
`(type,target)` cross their predicate within the window.

## Combined envelope (§20)

```
ACTIVE_EVENT_DERIVED_EFFECTS = ACTIVE_NETWORK_FLOW + ACTIVE_INCIDENT_ALERT
```
(persistent incident-status badges, building sprites, and UI are **excluded** — this counts
only the two event-derived effects.) Both terms scale with topology ⇒ the combined envelope
is **`UNBOUNDED_BY_CURRENT_CONTRACT`**.

## Empirical validation (§23 — real `simulation.step`, deterministic)

Drove the real engine (`simulation.step`, seed 7) over topologies built with real commands;
counted REQUEST_ROUTED / INCIDENT_OPENED per tick and computed peak active effects over a
sliding 6-tick window. (Throwaway probe; numbers recorded here per the gitignored-evidence
convention.)

| Scenario | LB×APP (edges) | users | routed/tick | peak ACTIVE_NET | peak ACTIVE_INC | peak combined | vs 128 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| single LB, 3 app | 1×3 (3) | 2000 | 3 | 18 | 3 | 21 | within |
| 2 LB, 4 app | 2×4 (8) | 4000 | 8 | 48 | 8 | 56 | within |
| 1 LB, 16 app (overload) | 1×16 (16) | 60000 | 16 | 96 | 33 | **129** | **exceeds** |
| 4 LB, 8 app | 4×8 (32) | 20000 | 32 | **192** | 32 | **224** | **exceeds** |
| 4 LB, 8 app (overload) | 4×8 (32) | 80000 | 32 | **192** | 65 | **257** | **exceeds** |
| 4 LB × all-APP disabled | 4×2 (8) | 500 | 0 | 0 | 4 (NO_HEALTHY_SERVER) | 4 | within |

Every `routed/tick`, `peak ACTIVE_NET`, and `peak ACTIVE_INC` value above is **directly
observed** from the real engine's emitted events (counted per tick, peak over a sliding
6-tick window); `ACTIVE_NET = routed_edges × 6` is the **formula**, which the observations
matched exactly (3→18, 8→48, 16→96, 32→192). Each row is a **currently-legal topology**
built with standard `ADD_NODE`/`CONNECT` commands (the `129` row is derived in §"129 example"
below). **Legal / reachable topology configurations can exceed the measured 128** at ≈16
overloaded app servers or ≈32 routed LB→APP edges — configurations permitted by the no-limit
`ADD_NODE`/`CONNECT` contract. (This is a statement about *reachable* configurations, **not**
about typical/expected/representative player workload — no such workload is defined; see below.)

### 129 example (§27) — explicit derivation

`1 LB × 16 app_servers`, all 16 connected and driven into overload (`users = 60000`): every
tick all 16 LB→APP edges route (`routed/tick = 16`) ⇒ `ACTIVE_NET = 16 × 6 = 96`
(formula-derived **and** directly observed). The overload simultaneously opens
`APP_CPU_OVERLOAD` and `APP_MEM_SATURATION` on app_servers plus the `REQUEST_TIMEOUT`
singleton, giving `peak ACTIVE_INC = 33` (directly observed). Combined peak `96 + 33 = 129`.
This is a legal current configuration (16 app_servers behind one LB is permitted; no cap).

## Representative vs contract maximum (§21/§22/§35)

- **`REPRESENTATIVE_WORKLOAD = UNDEFINED`.** The repo defines **no** canonical early/mid/late
  topology (empty initial state; no scenario/design sizes in `simulation/config` or `docs/`).
  The table above is **illustrative**, not a declared representative. Inventing sizes is out
  of scope (§3).
- **`CONTRACT_MAXIMUM = UNBOUNDED_BY_CURRENT_CONTRACT`** for Network, Incident, and combined —
  no node/edge cap in domain, UI, config, or schema.

## Baseline 0..128 coverage (§25/§30) & classification (§35)

The 0..128 capacity baseline reflects three simultaneous facts:
1. it **validly measured** a real range of legal configurations (it did not "fail");
2. **reachable legal configurations can exceed 128** (observed 192–257 combined);
3. the **contract maximum is unbounded**.

- **`BASELINE_0_128_COVERAGE = PARTIAL_CURRENT_CONTRACT_COVERAGE`** — it covers part of the
  legal configuration space (small topologies), not all of it.
- **`REACHABLE_WORKLOAD_ABOVE_BASELINE = YES`** (observed 192–257 combined).
- `BASELINE_COVERS_CONTRACT_MAXIMUM = FALSE` (`CONTRACT_MAXIMUM_UNBOUNDED`).
- Coverage-margin note (§26, observation only): the 0..128 baseline sits **below** reachable
  legal workloads (e.g. 128 / 224 ≈ 0.57×). This is an observation, NOT a safety factor,
  capacity margin, or approval — and NOT a statement that the baseline failed.

## Recommended next decision (§27/§35) — **PRODUCT_BOUND_REQUIRED_FIRST**

Because the contract maximum is **unbounded** and no representative/intended workload is
defined, a larger saturation sweep would have an **arbitrary target range**. The honest next
step is a **product decision first**: define the intended production envelope — either a
topology bound (max nodes/edges or max routed edges) **or** an event-derived effect-concurrency
policy (e.g. a cap/cull/pool for simultaneous effects). Only after an intended upper range
exists is a saturation sweep well-posed.

- `EVENT_DERIVED_SATURATION_SWEEP`: **`DEFERRED_PENDING_PRODUCT_ENVELOPE`** — with the contract
  maximum unbounded and no intended workload defined, there is no principled target for
  choosing 256 / 512 / 1024 / …. It becomes `JUSTIFIED` once a product bound or intended-max
  concurrency is chosen (and if that value approaches/exceeds 128, or an effect-concurrency
  policy needs a measured knee).
- `GPU_TIMING_INSTRUMENTATION` (§28/§33): **DEFERRED / NON_BLOCKING** — only pursue if a chosen
  workload approaches the measured boundary or an overlap/alpha concern becomes real.
- `LONG_TASK_INSTRUMENTATION` (§29/§34): **DEFERRED** — spawn/controller CPU observations in the
  capacity baseline were far below the sensitive range; not useful at currently-measured
  workloads.

## Product-limit gap (recorded, NOT implemented — §31/§34)

`PRODUCT_WORKLOAD_BOUND = NOT_DEFINED`. The simulation/UI currently impose **no** bound on
nodes, edges, or simultaneous event-derived effects, so the effect workload is formally
unbounded. Missing product decisions include: an intended node envelope, an intended LB→APP
edge envelope, an intended simultaneous event-derived-effect envelope, and/or a
visual-coalescing policy under high event density. Whether to add any of these is a **product
decision** — this track records the gap and adds **no** `MAX_ACTIVE_EFFECTS` / `EFFECT_BUDGET`
/ `SUPPORTED_CONCURRENCY` and **no** rejection/clamping logic.

## Asset state (§30) — unchanged

included **6**, `build_id ee6b2c89…`, C17 83,773 B, C18 6,291,456 B; verify-generated PASS,
asset-production-gate 26/26. No generator/gate change.

## Final classification (§35/§43)

- `REPRESENTATIVE_WORKLOAD`: **UNDEFINED** (no canonical gameplay sizes in-repo).
- `CONTRACT_MAXIMUM`: **UNBOUNDED_BY_CURRENT_CONTRACT** (network, incident, combined).
- `PRODUCT_WORKLOAD_BOUND`: **NOT_DEFINED**.
- `BASELINE_0_128_COVERAGE`: **PARTIAL_CURRENT_CONTRACT_COVERAGE**.
- `REACHABLE_WORKLOAD_ABOVE_BASELINE`: **YES**.
- Recommendation: **`PRODUCT_BOUND_REQUIRED_FIRST`**; `EVENT_DERIVED_SATURATION_SWEEP =
  DEFERRED_PENDING_PRODUCT_ENVELOPE`; `GPU_TIMING_INSTRUMENTATION = DEFERRED / NON_BLOCKING`;
  `LONG_TASK_INSTRUMENTATION = DEFERRED`.
- Next track is a **product decision** (`EVENT_DERIVED_PRODUCTION_ENVELOPE_POLICY`) that
  compares explicit alternatives — (A) topology-bound, (B) effect-visualization-bound,
  (C) hybrid — **not** implement one here.
