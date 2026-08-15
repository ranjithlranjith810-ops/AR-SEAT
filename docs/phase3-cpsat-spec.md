# Phase 3 — CP-SAT Seating Solver

> Specification only. No solver, FastAPI, Python, worker, or CP-SAT code is implemented by this document.
> The authoritative source of the current repository state is `docs/phase3-discovery.md` and the source files it cites.
> **Revision 6.** Revision 6 documents the objective-reporting rule for the solver response: the externally reported `objectiveValue` is always derived from the returned candidate→seat assignment, not from CP-SAT's internal `ObjectiveValue()` (§5, §11, §29). For **OPTIMAL** the two must agree; for **FEASIBLE** the raw `solver.ObjectiveValue()` may be inflated because the objective variables `o[s,t]` are only lower-bounded by the linking constraints and CP-SAT is not guaranteed to have minimized every auxiliary `o[s,t]` to its tight lower bound before a timeout — so the authoritative externally reported objective for FEASIBLE responses is `sameDepartmentAdjacentCount(returned assignment)`. This is a **reporting-only** change (owner-approved): the CP-SAT mathematical objective, Encoding D, the validator, and all frozen decisions are unchanged.
> **Revision 5.** Revision 5 resolves the last PROPOSED V1 decision (§28 item 10): the worker-count question is answered by the 500-student benchmark — `num_search_workers` is now **8** for production (§12, §15). It also adds the production memory-sizing note distinguishing the Approach A oracle from the Approach C + Encoding D production path (§12). No mathematical section, Encoding D, hard-rule scope, or objective changes. Revision 4 (below) introduced the oracle-agreement criterion and made independent-set pre-computation optional.

**Baseline:** `c7b4bc9` — `feat: complete exam document ingestion phase`
**Phase 2 status:** COMPLETE / VERIFIED / FROZEN
**Phase 3 status:** SPECIFICATION ONLY — IMPLEMENTATION NOT STARTED

---

## 1. Objective

Design the complete Phase 3 implementation specification for:

- A stateless **FastAPI + Python + OR-Tools CP-SAT** solver service (internal-only)
- A **Node worker** that orchestrates the existing SolveJob/SeatingPlan/SeatAssignment lifecycle
- The CP-SAT mathematical model (hard constraints + soft objective), chosen to be **exact** (no approximations of the rules) and **architecturally capable of 4 000–10 000** without a dense candidate×seat matrix
- Persistence, validation, heartbeat, recovery, benchmark, and test strategy

The repository already contains the full persistence + lifecycle layer (see §2). The greenfield work is the **solver engine**, the **worker orchestration**, and the **API boundary**.

---

## 2. Current Frozen Contracts

The following exist in the repository and are **treated as immutable contracts**. Do not modify them.

### 2.1 Solver input (`src/services/solverInput.service.ts`)

Exact types (verbatim):

```ts
export interface SolverCandidate {
  id: string;                       // examCandidate id
  registerNumberSnapshot: string;
  studentNameSnapshot: string;
  departmentSnapshot: string;       // department code at match time, e.g. "CSE"
  classSnapshot: string;            // class name at match time, e.g. "CSE-A"
  genderSnapshot: "MALE" | "FEMALE" | "OTHER";
  subjectCode: string;
  subjectName: string;
}

export interface SolverHallSeat {
  id: string;
  seatPosition: string;             // e.g. "A1"
  row: string;                      // letter, e.g. "A"
  column: number;                   // integer, 1-based
}

export interface SolverHall {
  id: string;
  hallNumber: string;
  name: string;
  building: string | null;
  rows: number;
  columns: number;
  capacity: number;                 // = count of active seats
  seats: SolverHallSeat[];          // active seats only, ordered row asc, column asc
}

export interface SolverInput {
  candidates: SolverCandidate[];
  candidateCount: number;
  halls: SolverHall[];
  availableSeatCount: number;       // Σ hall.capacity
}
```

`buildSolverInput(examId)` semantics (frozen):

- `candidates` = exam candidates with `validationStatus = VALIDATED` only
- `halls` = `isActive = true` halls only; `seats` = `isActive = true` seats only
- `capacity` = count of active seats per hall; `availableSeatCount` = Σ capacities
- Deterministic ordering: candidates by `registerNumberSnapshot` asc; halls by `hallNumber` asc; seats by `row` asc, `column` asc

**This gate must never be weakened or bypassed.**

### 2.2 Terminology — `classSnapshot` vs `departmentSnapshot` (VERIFIED)

From `src/services/candidate.service.ts` and `src/services/exam-document/ingest.ts`:

```ts
departmentSnapshot: student.class.department.code   // BRANCH, e.g. "CSE", "ECE", "EEE", "MECH"
classSnapshot:      student.class.name              // EXACT CLASS, e.g. "CSE-A", "CSE-B", "ECE-A"
```

Pinned by `tests/candidate.test.ts:45-46`:

```ts
expect(candidate.departmentSnapshot).toBe("CSE");
expect(candidate.classSnapshot).toBe("CSE-A");
```

**These are NOT interchangeable:**

- `classSnapshot` = exact class/section (`CSE-A` ≠ `CSE-B`).
- `departmentSnapshot` = branch/department code (`CSE` for both `CSE-A` and `CSE-B`).
- Every same-class pair is automatically same-department; the converse is false.

Every constraint in this specification states explicitly which snapshot it operates on. **The default V1 hard rule operates on `classSnapshot`** (§9); the soft objective operates on `departmentSnapshot` (§11). The Anna University PDF reference (§31) is branch-level mixing and is used as the reference output pattern, not as a change to the V1 hard rule — see §32.

### 2.3 SolveJob lifecycle (`src/services/solveJob.service.ts`)

- States: `QUEUED → RUNNING → {SUCCEEDED, INFEASIBLE, FAILED, CANCELLED}`
- `requestSolve({ examId, requestedBy?, timeLimitSeconds? })`, `startSolve(jobId)`, `heartbeat(jobId)`, `completeSolve(...)`, `markInfeasible(...)`, `failSolve(...)`, `cancelSolve(...)`, `reapStaleJobs(now, maxAgeMs = 60_000)`. Semantics as in the frozen code.

### 2.4 SeatingPlan lifecycle (`src/services/seatingPlan.service.ts`)

- `SeatingPlanStatus`: DRAFT / APPROVED / PUBLISHED / SUPERSEDED
- `createPlan` (auto-incrementing `version`, supersedes prior active plan), `approvePlan`, `publishPlan`, `supersedePlan`
- Unique `(examId, version)`; historical versions retained forever

### 2.5 SeatAssignment / Hall / HallSeat

- `assignCandidateSeat(...)` validated single-row insert; unique `(seatingPlanId, examCandidateId)` and `(seatingPlanId, hallId, hallSeatId)`
- `Hall`: `hallNumber` unique, `rows`, `columns`, `building?`, `isActive`
- `HallSeat`: `seatPosition` e.g. `A1`, `row` letter, `column` int, `isActive`; unique `(hallId, seatPosition)`
- Seeded hall `LH09` = 5×5 = 25 seats

### 2.6 Candidate gate (`src/services/candidate.service.ts`)

- Validation state machine `UNVERIFIED → MATCHED → VALIDATED`, any → `REJECTED`
- Snapshot immutability for candidates in PUBLISHED plans (`SNAPSHOT_LOCKED`)

### 2.7 Discrepancy check

No discrepancy found between `docs/phase3-discovery.md` and the current source.

---

## 3. Architecture

```text
Node (TypeScript)                                      Python (internal-only)
─────────────────────────────                          ───────────────────────────
Existing services                                        solver-service/
  candidate.service (VALIDATED gate)                      POST /solve  (stateless)
  solverInput.service → SolverInput  ──── JSON ───────▶   GET   /health
  solveJob.service (lifecycle)                            FastAPI + OR-Tools CP-SAT
  seatingPlan.service (versioning)                        no DB connection in V1
  seatAssignment.service (persistence)
  audit.service

Node worker (NEW, Phase 3):
  requestSolve → startSolve → heartbeat loop
  → buildSolverInput → POST /solve
  → validate response → persist transactionally
  → completeSolve | markInfeasible | failSolve
```

Rules:

- The FastAPI service is **stateless** and **never connects to PostgreSQL** in V1.
- The **Node worker owns all persistence**.
- The `VALIDATED` gate is enforced in Node before the solver is called and re-verified before persistence.

---

## 4. Solver Request Contract

`POST /solve` request body (JSON, pydantic-validated).

```json
{
  "requestId": "uuid",
  "examId": "uuid",
  "candidates": [
    { "id": "uuid", "registerNumber": "string", "studentName": "string",
      "department": "string", "class": "string",
      "gender": "MALE | FEMALE | OTHER",
      "subjectCode": "string", "subjectName": "string" }
  ],
  "halls": [
    { "id": "uuid", "hallNumber": "string", "name": "string", "building": "string | null",
      "rows": 5, "columns": 5, "capacity": 25,
      "seats": [ { "id": "uuid", "seatPosition": "A1", "row": "A", "column": 1 } ] }
  ],
  "timeLimitSeconds": 60,
  "solverConfig": {
    "model": "structured",             // "dense" | "structured" (validation oracle) — forced by config, not client
    "hardRuleScope": "class",          // "class" | "department" (V1 default "class")
    "randomSeed": 42,
    "numSearchWorkers": null
  }
}
```

The service must reject (HTTP 422) requests where: `candidateCount != candidates.length`; any candidate missing `id`/`class`/`department`; `halls` empty; a `seat` outside its hall's `rows × columns` grid; `timeLimitSeconds <= 0` or `> MAX_TIME_LIMIT_SECONDS`; `candidateCount > availableSeatCount` (Node normally short-circuits this, but the service must also refuse an impossible model).

No Supabase/Postgres credentials exist anywhere in the request.

---

## 5. Solver Response Contract

```json
{
  "requestId": "uuid",
  "status": "OPTIMAL | FEASIBLE | INFEASIBLE | ERROR",
  "assignments": [ { "candidateId": "uuid", "hallId": "uuid", "hallSeatId": "uuid" } ],
  "solverDurationMs": 0,
  "candidateCount": 0,
  "assignedCount": 0,
  "unassignedCount": 0,
  "objectiveValue": 0,
  "infeasibilityReason": null,
  "errorCode": null,
  "errorMessage": null
}
```

| Field | OPTIMAL | FEASIBLE | INFEASIBLE | ERROR |
|---|---|---|---|---|
| `assignments` | all | best found before timeout | `[]` | `[]` |
| `solverDurationMs` | ✓ | ✓ | ✓ | ✓ |
| `objectiveValue` | optimal value (validated) | recomputed from returned assignment (§5.1) | `null` | `null` |
| `infeasibilityReason` | `null` | `null` | business reason | `null` |
| `errorCode` | `null` | `null` | `null` | machine-readable |
| `errorMessage` | `null` | `null` | `null` | short summary |

Rules:

- `assignedCount` = `assignments.length`; `unassignedCount` = `candidateCount − assignedCount`
- **`ERROR` and `INFEASIBLE` responses must never be persisted as a successful seating plan.**
- `objectiveValue` = number of same-department adjacent pairs in the returned arrangement (§11), reported per the objective-reporting rule (§5.1).

### 5.1 Objective-reporting rule (OPTIMAL vs FEASIBLE)

The externally reported `objectiveValue` is **always** derived from the actual returned candidate→seat assignment, not from CP-SAT's internal `ObjectiveValue()`.

**OPTIMAL response:**

1. CP-SAT has proven global optimality.
2. Recompute `sameDepartmentAdjacentCount` from the returned assignment (§29).
3. The reported `objectiveValue` must agree with the validated assignment.
4. If the solver objective and the independently recomputed objective differ: mark the result **invalid**, do **not** silently overwrite the mismatch, and do **not** claim a valid OPTIMAL result.

**FEASIBLE response:**

1. CP-SAT found a feasible incumbent before the time limit.
2. Global optimality is **NOT** proven.
3. CP-SAT's internal `ObjectiveValue()` must **NOT** be treated as the authoritative externally reported objective.
4. Recompute `sameDepartmentAdjacentCount` from the actual returned candidate→seat assignment.
5. Set the externally reported `objectiveValue` to that recomputed value.
6. Preserve the raw solver objective separately in diagnostics/evidence where available.
7. Never claim that the recomputed FEASIBLE objective is globally optimal.

**Reason.** The objective variables `o[s,t]` are **lower-bounded** by the linking constraints (`o[s,t] ≥ w[s,d] + w[t,d] − 1`, §11.2). During a FEASIBLE timeout, CP-SAT is not guaranteed to have minimized every auxiliary `o[s,t]` variable to its tight lower bound before termination. Therefore `solver.ObjectiveValue()` may differ from the actual objective computed from the returned candidate→seat assignment. The authoritative externally reported objective for FEASIBLE responses is `sameDepartmentAdjacentCount(returned assignment)`.

This is a **reporting-only** rule: the CP-SAT mathematical objective (§11) is unchanged and the validator (§29) is not weakened.

---

## 6. Mathematical Model Review

This section reviews two independent design choices:

1. **Model family** (§6.1–§6.3): how candidates relate to seats overall.
2. **Same-class encoding** (§6.6): *within* the recommended model family, how the hard adjacency rule is formulated.

To avoid confusion, the model families are labelled **Approach A/B/C** and the same-class encodings are labelled **Encoding A/B/C/D**.

### 6.1 Approach A — Dense candidate×seat Boolean matrix

Variables: `x[c,s] ∈ {0,1}` → **`N×S` binaries**.

Constraints: H1 `Σ_s x[c,s]=1` (N); H2 `Σ_c x[c,s]≤1` (S); pairwise same-class adjacency `x[a,s]+x[b,t]≤1` → **`E·N²/K`** constraints (explosive).

Counts (`K=N/5`, 10×10 halls, S=N):

| N | Variables | Adjacency constraints (≈ E·N²/K) |
|---|---|---|
| 100 | 10 000 | ≈ 171 000 |
| 500 | 250 000 | ≈ 4.3 M |
| 1 000 | 1 000 000 | ≈ 17 M |
| 4 000 | 16 000 000 | ≈ 274 M |
| 10 000 | 100 000 000 | ≈ 1.7 B |

**Verdict: rejected for production.** Used only as a **validation oracle** at N = 100/500 (§6.4).

### 6.2 Approach B — Candidate integer seat-position variables

Variables: `seatIndex[c] ∈ {1..S}`, `AllDifferent(seatIndex)` → **`N` primary variables**.

**Problem:** same-class adjacency needs the class of each seat's occupant, which requires either channeling Booleans `y[c,s]=(seatIndex[c]==s)` (**`N×S` literals**) or per-seat-per-class `z[s,K]` with reified links (`N×S` literals again). So B's primary-variable win disappears the moment adjacency is added.

**Verdict: not better than A for this problem.** The decomposition insight in C is what matters.

### 6.3 Approach C — Structured seat-pattern model (RECOMMENDED FAMILY)

Key observation: **the objective and all hard constraints depend only on the class/department of a seat's occupant, never on the specific student.** Two candidates of the same class are interchangeable. So the problem separates into two stages:

**Stage 1 — seat→class pattern (the only CP-SAT stage):**

Variables:
- `z[s,K] ∈ {0,1}`: seat `s` occupied by class `K` → **`S×K` binaries**
- `o[s,t] ∈ {0,1}`: adjacent pair `(s,t)` hosts same-department occupants → **`E` binaries**

Constraints:
- C1 one class per seat: `Σ_K z[s,K] ≤ 1` → `S`
- C2 class quotas: `Σ_s z[s,K] = n_K` → `K`
- C3 same-class adjacency: **exact encoding** — see §6.6, Encoding D (per-seat implication form) → `S×K`
- Objective linking: `o[s,t] ≥ w[s,d]+w[t,d]−1` per edge per department → `E×D`

**Stage 2 — candidate→seat assignment (not CP-SAT):** a deterministic O(N) bijection of each class's candidates onto its seats (any bijection is optimal in V1).

Counts (Stage 1 only; K=N/5, D=4, 10×10 halls):

| N | S | K | E | Variables (S×K + E) | Constraints (S + K + S×K + E×D) |
|---|---|---|---|---|---|
| 100 | 100 | 20 | 342 | 2 342 | ~3 500 |
| 500 | 500 | 100 | 1 710 | 51 710 | ~58 000 |
| 1 000 | 1 000 | 200 | 3 420 | 203 420 | ~215 000 |
| 4 000 | 4 000 | 800 | 13 680 | 3 213 680 | ~3.26 M |
| 10 000 | 10 000 | 2 000 | 34 200 | 20 034 200 | ~20.2 M |

Same table with **department-scope** hard rule (K=D=4):

| N | Variables (S×K + E) | Constraints (≈) |
|---|---|---|
| 100 | 742 | ~1.8 k |
| 1 000 | 7 420 | ~14 k |
| 10 000 | 74 200 | ~144 k |

**Verdict: recommended model family.** Exact, tiny at 100/500, and — when combined with the exact Encoding D and the class-granularity lever (§32) — the only family capable of credibly reaching 4 000–10 000.

### 6.4 Selection procedure (benchmark before choosing)

1. Implement **Approach C** (structured) with **Encoding D** (exact per-seat implication) as production.
2. Implement **Approach A** (dense) as a **validation oracle** for N=100/500 and tests.
3. At N=100 and N=500, assert the oracle and the structured model **agree on the optimal `objectiveValue`** and that both produce **independently valid** seating arrangements per the acceptance criterion below. This empirically validates the decomposition and the encoding.
4. Only after that passes, scale up. If the structured model degrades, the fallback ladder is: department-scope hard rule (§32) → per-hall decomposition → heuristic warm start (future work, not V1).

**Acceptance criterion:** "Approach A oracle and Approach C must agree on the optimal objective value and both must produce independently valid seating arrangements." Concretely, both runs must report: (1) the **same optimal `objectiveValue`**; (2) all hard constraints satisfied; (3) `candidateCount == assignedCount`; (4) no duplicate candidate; (5) no duplicate seat; (6) `sameClassAdjacentCount == 0`; (7) `sameDepartmentAdjacentCount == objectiveValue`; (8) both pass the same authoritative Node validator (§29). Where useful, additionally compare the resulting **class→seat pattern** (e.g. per-hall class occupancy) rather than candidate identity. Candidate-for-candidate or byte-for-byte assignment identity is **not** required: different CP-SAT formulations can yield different optimal arrangements with the same optimal objective, and Approach C's independent stage-2 candidate→seat bijection makes candidate identity meaningless as an equivalence criterion.

### 6.5 Model size vs performance vs evidence (explicit distinction)

- **Theoretical model size** = the variable/constraint counts in §6.3/§6.6. These are arithmetic, not performance.
- **Expected CP-SAT performance** = qualitative (sparsity, big-M size, number of literals). See per-encoding notes.
- **Benchmark evidence** = what must be *measured*, not assumed: solve time, memory, objective value at each size, and oracle agreement (§6.4, §25).
- No claim of scalability is made from counts alone anywhere in this document.

### 6.6 Same-class encoding comparison (REQUIRED BY REVIEW)

All encodings below express the exact rule:

> **Exact same-class rule (R):** for every 8-neighbour seat pair `(s,t)` of the active-seat graph, `class(s) != class(t)` unless either seat is empty.

`N(s)` = active same-hall neighbours of seat `s`; `deg(s) = |N(s)|` (≤ 8). Empty seat = `Σ_K z[s,K] = 0`.

**Encoding A — closed-neighbourhood sum (REJECTED — INCORRECT):**

```text
z[s,K] + Σ_{t∈N(s)} z[t,K] ≤ 1        ∀ s, ∀ K
```

- Exact? **NO.** It requires "at most one class-K seat in `{s}∪N(s)`". This is *strictly stronger* than rule R.
  - **Counterexample 1 (empty seat):** `CSE-A – EMPTY – CSE-A` (a row: `a(m,left) m(empty) c(right)`, no `b`). The two CSE-A seats are **not** adjacent and rule R allows them. At the empty seat `m`: `Σ_{t∈N(m)} z[t,K] = z[a]+z[c] = 2 > 1` ⇒ Encoding A declares the instance infeasible. **Wrong.**
  - **Counterexample 2 (common neighbour):** seats `s=(0,0)` and `t=(1,2)` in a grid are not adjacent (Chebyshev distance 2) and share neighbour `u=(1,1)`. Rule R allows both to be class-K; Encoding A at `u` gives `Σ_{N(u)} z = 2 > 1` ⇒ infeasible. **Wrong.**
- Empty seats: mishandled (they impose restrictions on their neighbours).
- **Verdict: REJECTED.** Must not be implemented. This is the defect this revision fixes.

**Encoding B — exact pairwise edge/class:**

```text
z[s,K] + z[t,K] ≤ 1        ∀ edge (s,t) of the active-seat graph, ∀ K
```

- Exact? **YES** — this is rule R literally.
- Variables: none extra (uses `z`). Constraints: **`E×K`**.
- Empty seats: yes — an empty seat has `z[s,K]=0` for all `K`, so it forces nothing.
- Irregular active-seat layouts: yes (edges exist only between active same-hall seats).
- Counts (K=N/5, D=4): 100→6 840; 500→171 000; 1 000→684 000; 4 000→10.9 M; 10 000→**68.4 M** constraints.
- Memory: 68 M linear constraints at 10 000 ≈ tens of GB if materialized. Not viable at 10 000 (class scope).
- Performance: fine ≤ 1 000; heavy at 4 000; not viable at 10 000.
- **Verdict: exact fallback.** Use only if Encoding D's small big-M is ever shown problematic (benchmark). ~3.4× more constraints than D.

**Encoding C — integer seat-class variables with reification/table:**

Variables: `seatClass[s] ∈ {0..K}` (`0` = empty), `S` integer variables; occupancy reified; `o[s,t]` as before.

- Exact? **YES.** Per edge, forbid equal-nonzero class labels.
- Encodings of "not equal":
  - **Table/allowed-assignment:** `AddAllowedAssignments([seatClass[s], seatClass[t]], allowedPairs)` with `(K+1)² − K` allowed pairs → **`K²` per edge** — explodes for K ≈ 2 000. Not viable at scale.
  - **Reified inequality:** `E` constraints `(occupied[s] ∧ occupied[t]) ⇒ seatClass[s] ≠ seatClass[t]`. CP-SAT propagates integer inequalities well; the internal literal count is roughly `S·log₂(K)` for the integer encodings plus `E` reified constraints, but is **not enumerable a priori**.
- Class quotas (`Σ_s [seatClass[s]==K] = n_K`) require `AddExactly(seatClass, K, n_K)`; CP-SAT's internal encoding for exact-counts is opaque and may materialize `S×K` reified literals. **This is the key uncertainty.**
- Empty seats: yes (`0`). Irregular layouts: yes.
- Counts: primary `S` integers; `E` reified inequalities; quota machinery unknown.
- Performance: **unknown, potentially excellent** — this is exactly a bounded graph-colouring + equitable-colouring model. It is a credible alternative to Encoding D and must be benchmarked at 100/500 alongside it.
- **Verdict: benchmark alternative to D.**

**Encoding D — exact per-seat implication (RECOMMENDED):**

```text
Σ_{t∈N(s)} z[t,K] + deg(s)·z[s,K] ≤ deg(s)        ∀ s, ∀ K
```

- Exact? **YES — provably equivalent to Encoding B (rule R).**
  - If `z[s,K]=1`: constraint reduces to `Σ_{t∈N(s)} z[t,K] ≤ 0` ⇒ no class-K neighbour — exactly the edge rule at `s`.
  - If `z[s,K]=0`: `Σ_{t∈N(s)} z[t,K] ≤ deg(s)`, always true (there are `deg(s)` neighbours each ≤ 1) — **vacuous, imposes nothing**.
  - Therefore the set of feasible solutions equals rule R exactly.
- Variables: none extra (uses `z`). Constraints: **`S×K`** (≈3.4× fewer than B).
- Empty seats: yes — vacuous when `s` is empty; never restricts neighbours.
- Irregular active-seat layouts: yes — `N(s)` and `deg(s)` are computed from the active-seat graph only (inactive seats and other halls excluded).
- Big-M: `deg(s) ≤ 8` — small, so the LP relaxation stays tight; this is the only difference from B and it is benign at grid degree ≤ 8.
- Counts (K=N/5, D=4): same as §6.3 → 100: 2 000; 500: 50 000; 1 000: 200 000; 4 000: 3.2 M; 10 000: **20 M**. Department-scope (K=D=4): 10 000 → 40 000.
- Memory: 20 M sparse constraints (≤ 9 terms each) at 10 000 ≈ est. 1–4 GB — heavy but bounded; OK ≤ 4 000 (3.2 M).
- Performance: sparse, small big-M, linear; expected good. **Must still be benchmarked** (§25).
- **Verdict: RECOMMENDED primary encoding.** Exact, no candidate-pair explosion, and the best count of the exact encodings.

**Encoding comparison summary:**

| Encoding | Exact? | Extra vars | Constraints (class-scope, K=N/5) | Empty seats | Irregular layouts | 10 000 viability |
|---|---|---|---|---|---|---|
| A (sum) | **NO** | 0 | S×K (wrong) | broken | — | **REJECTED** |
| B (edge) | yes | 0 | E×K ≈ 68.4 M | yes | yes | no |
| C (integer) | yes | S ints | E reified + quota machinery | yes | yes | unknown — benchmark |
| D (implication) | **yes** | 0 | S×K ≈ 20 M | yes | yes | borderline — scope/decomp fallback |

---

## 7. CP-SAT Model (recommended: Approach C family, Encoding D)

### 7.1 Decision variables

Stage 1:

```text
z[s,K] ∈ {0,1}    seat s is occupied by a class-K candidate
o[s,t] ∈ {0,1}    adjacent seat pair (s,t) hosts same-department occupants (objective)
```

Derived (no new variables): `w[s,d] = Σ_{K∈d} z[s,K]` — department indicator of seat `s` (∈ {0,1} by C1).

Stage 2 (not CP-SAT): a deterministic bijection from candidates of class `K` to seats labeled `K`.

**There is no `N×S` matrix anywhere in the production model.**

### 7.2 Hard constraints (stage 1)

**C1 — One class per seat:**
```text
Σ_K z[s,K] ≤ 1        ∀ s
```

**C2 — Class quotas (exact counts):**
```text
Σ_s z[s,K] = n_K      ∀ K
```
`n_K` = number of VALIDATED candidates of class `K`. Together with C1 this occupies exactly `N` seats (the rest stay empty when `S > N`).

**C3 — Same-class adjacency (HARD, EXACT — Encoding D):**
```text
Σ_{t∈N(s)} z[t,K] + deg(s)·z[s,K] ≤ deg(s)        ∀ s, ∀ K
```
where `N(s)` = active same-hall 8-neighbours of `s`, `deg(s) = |N(s)|`.

- This is **equivalent** to `z[s,K] + z[t,K] ≤ 1` for every edge `(s,t)` and class `K` (proof in §6.6, Encoding D). It forbids two *adjacent* same-class seats and **nothing else**.
- It does **not** forbid same-class seats that share a common neighbour, nor same-class seats separated by an empty seat.
- **If the instance becomes impossible**, CP-SAT reports INFEASIBLE and the job becomes `INFEASIBLE` (`NO_FEASIBLE_ASSIGNMENT` / `CONSTRAINT_CONFLICT`) — never partial success. Pre-solve feasibility: `N ≤ S` is a mandatory cheap capacity check; class-level independent-set bounds are an **optional** early-infeasibility optimization only if the bound is cheap and provably safe for the given topology (§9, §20). CP-SAT remains the authoritative mechanism for proving infeasibility.

**C4 — Capacity:** `N ≤ S`, short-circuited in Node before the solver call (§16) and rejected by the service (422); implied structurally by C1/C2.

**C5 — Active resources only:** model only receives active halls/seats (frozen input); re-verified after solving (§18).

**C6 — No duplicate candidate/seat:** stage-2 bijection + DB unique indexes `(seatingPlanId, examCandidateId)` and `(seatingPlanId, hallId, hallSeatId)`.

### 7.3 How the layers protect the constraints

| Constraint | Pattern model | Stage-2 assignment | Node validation | Database |
|---|---|---|---|---|
| C1 one class/seat | `Σ_K z[s,K] ≤ 1` | seats partitioned by class | no duplicate seat ids | unique `(plan, hall, seat)` |
| C2 quota (= H1) | `Σ_s z[s,K] = n_K` | each candidate assigned once | assignedCount == candidateCount | unique `(plan, candidate)` |
| C3 same-class | Encoding D (exact edge rule) | — | sameClassAdjacentCount == 0 (§29) | — |
| C4 capacity | `N ≤ S` implied | — | candidateCount ≤ availableSeatCount | — |
| C5 active only | sets pre-filtered | — | seat ∈ active hall check | — |
| C6 no duplicates | — | bijection | dupCandidate/dupSeat == 0 | both unique indexes |

---

## 8. Adjacency Definition

**PROPOSED V1 DECISION — 8-neighbourhood.** Two seats are adjacent iff:

1. Same hall (different halls are never adjacent).
2. Chebyshev distance exactly 1: `|rowIndex(s)−rowIndex(t)| ≤ 1 ∧ |column(s)−column(t)| ≤ 1 ∧ s≠t` (horizontal, vertical, diagonal).

`rowIndex = ord(row) − ord('A')`; `column` 1-based; grids rectangular by construction of `createHall`.

Edge cases:

- First/last row/column — out-of-grid neighbours do not exist.
- Inactive seats — excluded from `SolverInput`, absent from every `N(s)` and from `deg(s)`.
- Empty seats — never contribute adjacency; they place **no** restriction on neighbours (guaranteed by Encoding D's vacuous case).

This definition is retained as the proposed V1 rule; it is consistent with the Anna University reference (§31).

---

## 9. Same-Class Separation (HARD)

**PROPOSED V1 DECISION — HARD CONSTRAINT, operating on `classSnapshot`.**

> `classSnapshot` = exact class, e.g. `CSE-A` (§2.2). "Same-class" does **not** mean same branch.

Exact rule (R):

```text
for every 8-neighbour seat pair (s,t) of the active-seat graph:
    not( class(s) = class(t) )   unless s or t is empty
```

Encoded exactly as Encoding D (§6.6, §7.2 C3):

```text
Σ_{t∈N(s)} z[t,K] + deg(s)·z[s,K] ≤ deg(s)        ∀ s, ∀ K
```

Properties:

- Mathematically exact: permits every arrangement allowed by R and forbids every arrangement R forbids (equivalence to the pairwise edge form, §6.6).
- **Does not forbid** same-class seats merely because they share a common neighbour, nor two same-class seats separated by an empty seat (the two failure modes of the rejected Encoding A).
- **No pairwise candidate explosion:** constraints are `S×K`, not `E·N²/K` (candidate-pair) — this claim is now attached to a *correct* formulation.
- If impossible → `INFEASIBLE` (`NO_FEASIBLE_ASSIGNMENT` / `CONSTRAINT_CONFLICT`), never partial success.
- Pre-solve infeasibility checks are tiered (§20): (1) **proven cheap checks** — `N ≤ S` capacity, structural validation — are mandatory; (2) **optional upper bounds** — e.g. a class whose count exceeds a *cheap, provably safe* independent-set bound for the active-seat graph may be rejected early; (3) **CP-SAT-proven infeasibility** — the authoritative mechanism. An instance is never classified `INFEASIBLE` from an unproven heuristic bound; if an exact maximum-independent-set computation is not cheap for the given topology, it is not performed.
- `hardRuleScope = "class"` default; `"department"` alternative in §32 (same Encoding D, `K` replaced by `D`).

---

## 10. Gender Rule

**No V1 gender constraint.** `gender`/`genderSnapshot` is available but unused for seating in V1; reserved for future configurable rules. No code path may branch on gender.

---

## 11. Soft Objective — Department Mixing (re-verified correct)

**PROPOSED V1 DECISION.** Minimize same-**department** adjacency (operating on `departmentSnapshot`).

### 11.1 Objective

```text
minimize  Σ_{(s,t) adjacent} o[s,t]
```

`objectiveValue` = returned sum, reported per the objective-reporting rule (§5.1): for OPTIMAL responses it equals `solver.ObjectiveValue()` and must agree with the recomputed `sameDepartmentAdjacentCount`; for FEASIBLE responses it is recomputed from the returned assignment because CP-SAT's internal `ObjectiveValue()` may be inflated on non-same-department edges (§5.1).

### 11.2 Linking constraints (unchanged from revision 2 — confirmed correct)

Let `w[s,d] = Σ_{K∈d} z[s,K]` (department indicator of seat `s`; ≤ 1 by C1). For **every** adjacent seat pair `(s,t)` and **every** department `d`:

```text
o[s,t] ≥ w[s,d] + w[t,d] − 1
```

Semantics:

- Both occupied by department `d` (`w[s,d]=w[t,d]=1`) ⇒ RHS=1 ⇒ `o[s,t]=1`.
- Different departments or an empty seat ⇒ for every `d`, RHS ≤ 0 ⇒ minimization drives `o[s,t]=0`.
- Exactly one department can trigger `o[s,t]=1` per pair (a seat has ≤ 1 department by C1).

### 11.3 The requested mapping

```text
seat S → candidate C1 → department D1     w[S,D1] = 1 (via z[S,class(C1)] = 1)
seat T → candidate C2 → department D2     w[T,D2] = 1
D1 == D2  ⇒  o[S,T] ≥ w[S,D1]+w[T,D1]−1 = 1  ⇒  o[S,T] = 1
D1 != D2  ⇒  ∀d: RHS ≤ 0                  ⇒  o[S,T] = 0 (minimized)
```

### 11.4 Empty-seat verification (required by review)

**Empty seats do not contribute to the objective.** If seat `s` is empty then `z[s,K]=0 ∀K`, hence `w[s,d]=0 ∀d`, and for every adjacent pair `(s,t)` and every `d`: `o[s,t] ≥ 0 + w[t,d] − 1 ≤ 0`. So no `o` variable is forced by an empty seat, and empty-seat pairs never add to `Σ o[s,t]`. `o[s,t]` is forced to `1` **only** when both seats are occupied by the same department. The objective is therefore exactly "number of adjacent occupied seat pairs whose departments match" — and `objectiveValue == sameDepartmentAdjacentCount` (§29) by construction.

### 11.5 Hard/soft separation

- The objective never violates C1–C6; a hard-infeasible instance returns INFEASIBLE; otherwise always FEASIBLE/OPTIMAL.
- It never fights C3: class ⊆ department, so any C3-violating pair is also same-department, but C3 forbids it outright; the objective counts only *remaining* same-department pairs (different classes, same branch).
- Hall-fragmentation is documented as a possible secondary tier, not part of V1's single objective (§28).

---

## 12. Solver Parameters

- `max_time_in_seconds = timeLimitSeconds`; `random_seed` default 42; `num_search_workers` default 8; `log_search_progress = true` (counts/durations/statuses only). No other tunables in V1.
- **Worker-count decision (owner-approved, 2026-08-14):** **8 workers is the V1 production default.** Basis: the 500-student benchmark (§28 item 10, §36). Single-worker mode (`num_search_workers=1`) could not prove optimality on the tested 500-student dataset within 900 s — it returned FEASIBLE with objective 129. The same production model (Approach C, Encoding D) with `num_search_workers=8` proved OPTIMAL, objective 0, in ≈47 s on the measured host. Worker count affects runtime and may affect the exact optimal arrangement chosen; **do not** claim byte-for-byte deterministic assignments across worker counts. The correctness comparison is `objectiveValue` plus independent validation by the authoritative validator (§15, §29), not assignment identity. The 8-worker performance figure is benchmark evidence on the measured host, not a universal guarantee across all hardware.
- **Memory sizing note (production):** Approach A memory measurements are benchmark/validation-only. Production memory sizing must use the Approach C + Encoding D measurements (Approach C + Encoding D peak RSS ≈1.37 GB at 500 students on the measured host; Approach A ≈3.64 GB — dense oracle, benchmark/validation only, **never deployed**). The 1.37 GB figure at 500 does **not** prove memory requirements at 4,000 or 10,000 candidates — those sizes require separate benchmarks.

---

## 13. Hall Allocation

**PROPOSED V1 DECISION — one global solve pool.** One stage-1 pattern instance over all candidates, all active halls, all active seats; hall+seat chosen simultaneously; single global capacity check. Per-hall decomposition is a future scale lever (§30.5), not V1.

---

## 14. Seat Ordering

```text
halls: hallNumber asc;  seats: row asc then column asc (within hall);  candidates: registerNumber asc
```

- Solver uses request indices without re-ordering; stage-2 assignment iterates in this order; response `assignments` sorted `hallNumber → row → column`; DB numbering unchanged.

---

## 15. Determinism

Fixed ordering (§14), `random_seed` 42, `num_search_workers` 8 ⇒ same output for same input on the same machine/container. Not guaranteed across OR-Tools versions, architectures, or worker counts. Worker count affects runtime and may change the exact optimal arrangement; **do not** claim byte-for-byte deterministic assignments across worker counts. The comparable correctness metric is `objectiveValue` plus independent validity per the authoritative validator (§29), not assignment identity.

---

## 16. Time Limits

- `timeLimitSeconds` default **60 s**, max `MAX_TIME_LIMIT_SECONDS = 3600`.
- Timeout mapping: feasible found → **FEASIBLE** (best); proven infeasible → **INFEASIBLE**; timeout with no solution found, infeasibility unproven (CP-SAT `UNKNOWN`) → **ERROR** (`SOLVER_TIMEOUT_NO_SOLUTION`), never success and never unproven-INFEASIBLE.
- Node mirrors: `completeSolve(FEASIBLE)` or `failSolve(SOLVER_TIMEOUT_NO_SOLUTION)`.

---

## 17. Persistence Strategy

The solver never touches the database. Node performs persistence.

```text
FastAPI → validated SolverResponse
  ↓ Node worker
  1. post-solver validation (§18)
  2. createPlan(examId)                    → DRAFT plan (new version)
  3. write SeatAssignments (batched)       → in one transaction
  4. completeSolve(jobId, OPTIMAL/FEASIBLE)→ SUCCEEDED
```

- Steps 2–4 in one `prisma.$transaction`; any failure rolls back; job never SUCCEEDED; worker calls `failSolve(PERSISTENCE_ERROR)`.
- **Proposed (not implemented):** batched `createAssignments(seatingPlanId, assignments[])` using `createMany` (the existing `assignCandidateSeat` is a validated single-row insert, too slow at 4 000+).

---

## 18. Post-Solver Validation

Two layers:

1. **Python (structural):** response well-formed; every candidateId ∈ request; every hallSeatId ∈ request; no duplicate candidate/seat ids; `assignedCount == assignments.length`. Failure → `ERROR`.
2. **Node (authoritative, before persistence):** `candidateCount == assignedCount`; no duplicate candidate/seat ids; every seat in an active hall; every candidate VALIDATED for the job's exam; capacity respected; `hallId` owns `hallSeatId`; §29 metrics all-green (`sameClassAdjacentCount == 0`, `unassignedCount == 0`, duplicates == 0).

Any failure ⇒ job `FAILED` (`INVALID_SOLVER_OUTPUT`), never SUCCEEDED.

---

## 19. SeatingPlan Lifecycle

Existing versioned `SeatingPlan`: generate (DRAFT) → review → APPROVED → PUBLISHED (supersedes other PUBLISHED plans). Each solve = new version; historical versions recoverable; candidate snapshots immutable once PUBLISHED (`SNAPSHOT_LOCKED`).

---

## 20. Infeasibility Handling

| Reason | When | Job status |
|---|---|---|
| `INSUFFICIENT_SEATS` | `candidateCount > availableSeatCount` (mandatory cheap pre-solve check) | INFEASIBLE |
| `NO_FEASIBLE_ASSIGNMENT` | CP-SAT proved infeasible | INFEASIBLE |
| `CONSTRAINT_CONFLICT` | infeasible driven by C3, proven by CP-SAT (or by a cheap provably safe pre-solve bound, §9/§20) | INFEASIBLE |
| `INVALID_SOLVER_INPUT` | request fails structural validation | ERROR/FAILED |
| `SOLVER_TIMEOUT_NO_SOLUTION` | timeout, no solution, infeasibility unproven | ERROR/FAILED |

Pre-solve classification is tiered (§9):

1. **Proven cheap checks (mandatory):** `candidateCount > availableSeatCount` and structural validation are decided before the solver call.
2. **Optional upper bounds:** a class count vs a *cheap, provably safe* independent-set bound may fail fast, but only if the bound is genuinely cheap for the given topology; it must never flag a feasible instance.
3. **CP-SAT-proven infeasibility (authoritative):** any infeasibility claim not provable cheaply is left to CP-SAT. An exact maximum-independent-set computation is **not** a prerequisite — it is itself an optimization problem and may be as expensive as the solve. Never classify an instance `INFEASIBLE` from an unproven heuristic bound.

No Python tracebacks to end users; business reasons only; full diagnostics stay in PII-scrubbed service logs.

---

## 21. FastAPI Boundary

- `POST /solve`, `GET /health`; pydantic validation; 422 malformed.
- `MAX_CANDIDATES` (default 10 000), body size 16 MB, 413 oversized.
- Internal-only (private interface); `X-Internal-Token` auth (constant-time), 401 on missing/invalid, never fail open.
- Client timeout = `timeLimitSeconds + 30 s`; server enforces its own ceiling.
- Logging: correlation via `requestId`; counts/durations/statuses only — never names/register numbers/full datasets.

---

## 22. Python Service Structure

Proposed (created in the implementation phase, not now):

```text
solver-service/
├── app/
│   ├── __init__.py
│   ├── main.py          # FastAPI app; POST /solve, GET /health; wiring
│   ├── models.py        # pydantic schemas (request §4, response §5)
│   ├── solver.py        # Approach C stage-1 CP-SAT: model build, solve, status mapping, timing
│   ├── assign.py        # stage-2 deterministic candidate→seat assignment (O(N))
│   ├── constraints.py   # adjacency (8-neighbourhood), C1–C3 builders, Encoding D, objective linking (§11.2)
│   ├── validation.py    # structural response validation, status/field mapping
│   └── config.py        # settings: time caps, seed, auth token, payload limits, model/scope
├── tests/
│   ├── test_adjacency.py
│   ├── test_pattern_model.py
│   ├── test_sameclass_encoding.py   # Encoding D == Encoding B on random grids; regression for §6.6 A
│   ├── test_constraints.py
│   ├── test_objective_link.py       # o[s,t] forced by occupancy; empty seats contribute nothing (§11.4)
│   ├── test_assignment.py
│   ├── test_validation.py
│   └── test_api.py
├── requirements.txt     # fastapi, uvicorn, ortools, pydantic, pydantic-settings, pytest, httpx
└── Dockerfile
```

---

## 23. Security Requirements

1. FastAPI never public. 2. `X-Internal-Token`, constant-time compare. 3. Request size limits. 4. **No DB credentials in Python.** 5. **No Supabase service-role key in Python.** 6. No student PII in logs beyond ids. 7. Never log full candidate datasets. 8. Validate every response before persistence. 9. Audit solve lifecycle via existing `logAudit`. 10. `requestId` correlation everywhere.

---

## 24. Testing Strategy

### Unit (Python)

- adjacency computation (8-neighbourhood, edges, irregular/inactive seats)
- pattern variable/constraint counts (S×K + E; §6.3)
- **same-class encoding correctness (new, required):**
  - *Regression (rejected A):* a row `CSE-A – EMPTY – CSE-A` must be **feasible**; the two same-class seats are non-adjacent.
  - *Regression (rejected A):* two same-class seats sharing a common neighbour but not adjacent must be **feasible**.
  - *Positive:* two adjacent same-class seats must be **infeasible**.
  - *Equivalence fuzz:* on random small active-seat grids, Encoding D and Encoding B admit exactly the same solutions.
  - *Vacuousness:* an empty seat must place no restriction on its neighbours.
- objective-link: `o[s,t]==1` iff both adjacent seats host same-department occupants; empty seats contribute nothing (§11.4); all-zero objective impossible while same-department adjacency exists
- deterministic ordering (§14); status mapping incl. timeout semantics; stage-2 bijection invariants

### Integration

- Node → FastAPI (auth, contract, timeout, correlation)
- FastAPI → CP-SAT (small seeded fixture; assert C1–C3 hold on output)
- **Approach A oracle vs Approach C agreement at N=100 and N=500**: same optimal `objectiveValue` + both independently valid per the §6.4 acceptance criterion (not candidate-identical)
- solver response validation (Node authoritative)
- infeasible instances (insufficient seats; same-class blob → `CONSTRAINT_CONFLICT`)

### End-to-end (Node, `exam_seating_test`)

```text
VALIDATED candidates → requestSolve → startSolve → buildSolverInput
→ POST /solve → validate → transaction (createPlan + createAssignments)
→ completeSolve → seating plan PUBLISHED
```

### Failure cases

insufficient seats · no feasible solution · timeout (FEASIBLE vs SOLVER_TIMEOUT_NO_SOLUTION) · malformed request (422) · invalid candidate · duplicate assignment (unique indexes) · worker crash (stale heartbeat → FAILED) · stale heartbeat (`reapStaleJobs`).

---

## 25. Benchmark Strategy

Progression: `100 → 500 → 1 000 → 4 000 → 10 000`.

- **First benchmark: 100 students / 2 halls**, synthetic VALIDATED candidates, hard class rule + department objective.
- At 100 and 500: Approach A oracle vs Approach C **agreement** — same optimal `objectiveValue` and both independently valid (§6.4 acceptance criterion) — **and** Encoding D vs Encoding C runtime comparison.
- For each size capture (implementation-time table in `docs/phase3-benchmarks.md`):

```text
candidateCount, hallCount, seatCount, classCount (K), departmentCount (D),
variableCount, hardConstraintCount, solveDurationMs, solverStatus,
objectiveValue, assignedCount, unassignedCount, memory, CPU
```

- `timeLimitSeconds` per size (proposed): 100→30, 500→60, 1 000→120, 4 000→300, 10 000→600 (configurable).
- **Evidence gating:** no 10 000 claim without (a) 100/500 oracle agreement (same optimal `objectiveValue` + both independently valid, §6.4), (b) a successful 4 000 run within its time limit and memory budget. A 10 000 run is attempted only after 4 000 passes; if it fails, adopt the §30.5/§32 fallbacks (department scope or per-hall decomposition). Benchmarks are **not run in this task**.

---

## 26. Acceptance Criteria

```text
✓ Solver request contract implemented
✓ Approach C (structured pattern) model implemented
✓ Encoding D (exact same-class) implemented; rejected Encoding A is NOT present
✓ Encoding D == Encoding B equivalence verified (unit fuzz)
✓ Same-class empty-seat / common-neighbour regressions pass (§6.6 counterexamples)
✓ Hard constraints C1–C4 verified
✓ Department-mixing soft objective verified (o[s,t] linked; empty seats contribute nothing)
✓ INFEASIBLE handled (INSUFFICIENT_SEATS / NO_FEASIBLE_ASSIGNMENT / CONSTRAINT_CONFLICT)
✓ FEASIBLE timeout handled (best solution returned)
✓ SOLVER_TIMEOUT_NO_SOLUTION → ERROR (never success, never unproven-INFEASIBLE)
✓ FastAPI isolated (stateless, no DB, internal-only, no secrets)
✓ Worker lifecycle integrated (requestSolve → startSolve → heartbeat → complete/fail/infeasible)
✓ Heartbeat works (interval < reap threshold, safety margin)
✓ Stale jobs recover (reapStaleJobs)
✓ Solver output validated (Node authoritative)
✓ SeatingPlan persisted transactionally
✓ SeatAssignments persisted correctly (batched, unique constraints hold)
✓ 100-student benchmark passes (100 / 2 halls), oracle-agreed (same optimal objective, both independently valid)
✓ Larger benchmark results documented (1 000 / 4 000 / 10 000)
✓ Solver-output validation report (§29) all-green on every run
✓ Anna University output-pattern reference case reproduced (§31)
✓ Security checks pass
✓ Tests pass
```

---

## 27. Implementation Order

1. Scaffold `solver-service/` (config, models, routes, Dockerfile, requirements).
2. `constraints.py` — adjacency + unit tests.
3. Stage-1: C1–C3 with **Encoding D** on a tiny fixture.
4. Objective linking (§11.2) + minimize.
5. Stage-2 assignment (`assign.py`).
6. `validation.py` + status mapping + timeout semantics.
7. FastAPI `POST /solve` + `GET /health` + auth + payload limits.
8. Approach A oracle (test-only, 100/500) + agreement test (same optimal objective + independent validity, §6.4); Encoding D vs B fuzz; C benchmark.
9. Node worker lifecycle + heartbeat + HTTP client (requestId).
10. Node post-solver validation + batched transactional persistence (`createAssignments`).
11. End-to-end + failure-case tests.
12. Benchmarks 100 → 10 000, document results.
13. Output-pattern reference (Anna University layout, §31).
14. Security hardening + acceptance walkthrough.

---

## 28. Open Product Decisions

**PROPOSED V1 DECISIONS** (need owner sign-off — not pre-approved):

1. Hard rule scope = `classSnapshot` (exact class), 8-neighbourhood — §9, §32.
2. Soft objective = minimize same-department adjacency, linked — §11.
3. Gender — no V1 constraint — §10.
4. Hall allocation — one global pool — §13.
5. Solver topology — stateless FastAPI + OR-Tools CP-SAT, no DB in V1 — §3, §21.
6. Model family = Approach C; same-class encoding = **Encoding D**; Approach A as 100/500 oracle; Encoding C benchmarked as alternative — §6.
7. Timeouts — default 60 s, max 3600 s, client = limit + 30 s — §16.
8. Timeout-no-solution → ERROR (`SOLVER_TIMEOUT_NO_SOLUTION`) — §16.
9. Heartbeat 15 s vs reap 60 s — retained existing default.
10. Determinism — seed 42, `num_search_workers` 8 — §12, §15. **(RESOLVED — owner-approved 2026-08-14.)**
11. Batched persistence via additive `createAssignments` — §17.

**UNRESOLVED (owner input required):** benchmark dataset distribution; auto-publish vs explicit review; FastAPI deployment topology/network path; `INSUFFICIENT_SEATS` admin UX; hall-fragmentation secondary objective tier.

---

## 29. Solver-Output Validation Report

After every solve, Node computes and records (audit metadata + benchmark table):

```text
candidateCount, assignedCount, unassignedCount,
duplicateCandidateCount, duplicateSeatCount,
sameClassAdjacentCount,      // computed pairwise over the active-seat graph (exact), NOT via any neighborhood sum
sameDepartmentAdjacentCount, // == objectiveValue by construction
hallsUsed, objectiveValue
```

**Required V1 correctness (every run):**

```text
sameClassAdjacentCount = 0
unassignedCount        = 0
duplicateCandidateCount = 0
duplicateSeatCount     = 0
```

`sameDepartmentAdjacentCount` is the authoritative externally reported `objectiveValue` (see the objective-reporting rule §5.1) and is the optimization score for comparing runs/benchmarks. Any violation of the required zeros ⇒ job `FAILED` (`INVALID_SOLVER_OUTPUT`).

---

## 30. Revision-3 Model Summary (the review responses)

### 30.1 Dense `x[c,s]` replaced

Production model = Approach C: stage-1 seat→class pattern (`z[s,K]`, S×K) + stage-2 O(N) assignment. Approach A is test/benchmark-only.

### 30.2 Objective `o[s,t]` fully linked (re-verified)

`o[s,t] ≥ w[s,d] + w[t,d] − 1` per adjacent pair per department; `w[s,d] = Σ_{K∈d} z[s,K]`. An all-zero objective with same-department adjacency is structurally impossible. **Empty seats verified to contribute nothing** (§11.4).

### 30.3 Same-class encoding corrected (the reason for this revision)

The revision-2 C3 `z[s,K] + Σ_{t∈N(s)} z[t,K] ≤ 1` was **wrong**: it enforced "at most one class-K seat in `{s}∪N(s)`", which is stricter than the intended edge rule. It incorrectly made feasible arrangements infeasible, e.g.:

- `CSE-A – EMPTY – CSE-A`: two non-adjacent same-class seats separated by an empty seat — the empty seat's constraint sums to `0 + 1 + 1 = 2 > 1` and the instance is wrongly declared infeasible.
- Two non-adjacent same-class seats sharing a common neighbour (e.g. `(0,0)` and `(1,2)` sharing `(1,1)`).

**Replaced by Encoding D** (exact per-seat implication):

```text
Σ_{t∈N(s)} z[t,K] + deg(s)·z[s,K] ≤ deg(s)        ∀ s, ∀ K
```

provably equivalent to the exact pairwise edge form `z[s,K] + z[t,K] ≤ 1` (vacuous when `z[s,K]=0`, forces all neighbours to zero when `z[s,K]=1`).

**The claim that the old constraint was "pairwise explosion-free" is withdrawn** — the claim is now made only about the *correct* Encoding D, which is exact and keeps the S×K count without the candidate-pair explosion.

### 30.4 `classSnapshot` vs `departmentSnapshot`

Verified in §2.2. Hard rule defaults to `classSnapshot`; soft objective uses `departmentSnapshot`. Not interchangeable.

### 30.5 Remaining mathematical risks

- **Class granularity is the scaling lever.** Exact-class K ≈ N/5; at 10 000 the stage-1 model is ~20 M constraints (Encoding D) / 68 M (Encoding B). This is an estimate, not evidence; it must be validated by benchmark.
- **Exact 10 000 in a single CP-SAT instance is realistically NOT achievable with the class-scope rule** (K≈2 000 → 20 M constraints, est. 1–4 GB). The honest paths to 10 000: department-scope hard rule (K=D≈4–10 → ~40 k–74 k constraints) or per-hall decomposition. These are the §32 fallbacks.
- **Feasibility vs the hard rule:** a class larger than the maximum independent set of the active-seat graph is infeasible *in principle*; this is only acted on when a **cheap, provably safe** bound exists (§9/§20). An exact maximum-independent-set computation is **not** a prerequisite — it may itself be as expensive as the solve. CP-SAT is the authoritative infeasibility mechanism; a timeout must never be mis-reported as `CONSTRAINT_CONFLICT`.
- **Encoding C uncertainty:** its exact-count machinery (`AddExactly`) is opaque; it may be the best runtime but is unproven — benchmark at 100/500.
- **CP-SAT determinism** is not cross-version guaranteed (§15).
- **Stage-2 bijection** depends on C2 quotas; re-asserted in Node validation.
- **LP-quality of Encoding D:** the small big-M (`deg(s) ≤ 8`) is benign, but the 100/500 oracle agreement (§6.4) is the empirical gate.

---

## 31. Reference Output Pattern (Anna University seating)

The provided real Anna University seating PDFs (external reference, not in the repository) show the target output shape: per-hall grid (`A1…`), each cell = Register Number + Branch, with branches **mixed across adjacent seats** (e.g. LH09 alternates CSE/ECE; LH13 mixes CSE/Mechanical).

Implications:

1. **Output-format acceptance case:** the end-to-end path must produce this per-hall grid style; `Hall`/`HallSeat` topology already matches.
2. **Department mixing is real-world behaviour:** the soft objective (§11) produces alternating branches when departments are balanced.
3. **Acceptance test:** a ~50/50 CSE/ECE hall must reproduce the mixed pattern — `sameDepartmentAdjacentCount` at its achievable minimum and all §29 required zeros.
4. The pattern is branch-level; it does not decide the V1 hard-rule scope (§32).

---

## 32. Hard-Rule Scope Decision (class vs department)

| Scope | Rule | K in model | Constraints at 10 000 (Encoding D) | Matches PDF pattern? |
|---|---|---|---|---|
| **class** (V1 default) | no adjacent same-`classSnapshot` | ~N/5 | ~20 M | no (PDFs mix at branch level) |
| **department** | no adjacent same-`departmentSnapshot` | D ≈ 4–10 | ~40 k–74 k | yes (LH09/LH13) |

Trade-offs: class scope is safer (fewer false infeasibilities — CSE-heavy exams stay feasible) but large at 10 000; department scope matches the real examples and scales dramatically, but can render dense single-branch exams infeasible.

**Recommendation:** keep the **class-scope hard rule for V1** (correctness first at 100–1 000), re-benchmark at 4 000/10 000, and make `hardRuleScope` a config parameter from day one so switching to department scope is a config change, not a rewrite.

---

## 33. Summary for Review

1. **Recommended model:** Approach C (structured) with **Encoding D** for same-class. Stage 1 CP-SAT seat→class pattern (`z[s,K]`, S×K); stage 2 O(N) bijection. No dense N×S matrix.
2. **Estimated counts** (10×10 halls, K=N/5, D=4): variables/constraints — 100: 2.3 k/3.5 k; 500: 51.7 k/58 k; 1 000: 203 k/215 k; 4 000: 3.2 M/3.26 M; 10 000: 20 M/20.2 M. Department-scope 10 000: ~74 k/144 k.
3. **Same-class encoding:** `Σ_{t∈N(s)} z[t,K] + deg(s)·z[s,K] ≤ deg(s)` — exact, S×K, no candidate-pair explosion, empty seats place no restriction.
4. **Department objective:** `min Σ o[s,t]` with `o[s,t] ≥ w[s,d]+w[t,d]−1`; `objectiveValue == sameDepartmentAdjacentCount`; empty seats contribute nothing.
5. **FastAPI contract:** stateless internal `POST /solve` + `GET /health`, `X-Internal-Token`, pydantic, payload limits, no DB.
6. **Worker lifecycle:** `requestSolve → startSolve → heartbeat(15 s) → buildSolverInput → POST /solve → validate → transaction(createPlan + batched assignments) → completeSolve`, or `markInfeasible`/`failSolve`.
7. **Persistence flow:** Node-only, transactional, rollback on failure; never SUCCEEDED without a persisted plan.
8. **Benchmark plan:** 100 (2 halls, oracle agreement + encoding comparison) → 500 → 1 000 → 4 000 → 10 000, with evidence gating (§25). Oracle agreement = same optimal `objectiveValue` + both independently valid (§6.4), never candidate-identical output.
9. **Infeasibility pre-checks are tiered (§9, §20):** mandatory cheap checks (`N ≤ S`, structural validation); optional cheap provably safe bounds (independent-set bound only if cheap for the topology); CP-SAT-proven infeasibility as the authoritative mechanism. No `INFEASIBLE` from an unproven heuristic bound.
10. **Remaining decisions:** hard-rule scope (§32), benchmark dataset mix, publish-vs-review step, deployment topology, INSUFFICIENT_SEATS UX, fragmentation objective tier.

---

## 34. Implementation-Freeze Reminder

Only `docs/phase3-cpsat-spec.md` may change as a result of this revision. No Python, FastAPI, OR-Tools, CP-SAT, worker, Prisma, migration, test, or Phase 2 source was created or modified. Implementation must not start until the owner approves this revision — especially §6.6 (encoding comparison), §7.2 C3, §11 (objective), and §32 (scope decision).

---

## 35. Review Responses

1. **Exact formulation selected:** Encoding D — `Σ_{t∈N(s)} z[t,K] + deg(s)·z[s,K] ≤ deg(s)` for every seat `s` and class `K`, within the Approach C structured family. Equivalent to the pairwise edge form `z[s,K]+z[t,K]≤1`.
2. **Why it is mathematically correct:** proven equivalence to rule R (§6.6, Encoding D): the `z[s,K]=1` case forces all neighbours to zero (exactly the edge rule at `s`); the `z[s,K]=0` case is vacuous (`Σ ≤ deg(s)` always). It forbids exactly the adjacent same-class pairs and nothing else — including allowing same-class seats separated by an empty seat or sharing a common neighbour.
3. **Why revision-2 C3 was wrong:** it enforced "at most one class-K seat in `{s}∪N(s)`", a strictly stronger property than non-adjacency. The empty-seat and common-neighbour cases (§6.6, Encoding A) made valid arrangements infeasible.
4. **Variable count (Encoding D, K=N/5, D=4):** 100→2 342; 500→51 710; 1 000→203 420; 4 000→3 213 680; 10 000→20 034 200.
5. **Constraint/literal count (same assumptions):** ~3 500; ~58 000; ~215 000; ~3.26 M; ~20.2 M.
6. **Remaining scalability risk:** class granularity (K≈N/5) drives the S×K term; 10 000 class-scope is ~20 M constraints (est. 1–4 GB). Mitigations: department scope (§32, →~74 k) or per-hall decomposition (§30.5). All counts are estimates gated on benchmark.
7. **Is an exact 10 000-student solve realistically achievable?** With the class-scope hard rule in a single instance, **no** (20 M constraints, memory-bound). With the department-scope rule, **yes** (~74 k constraints). Per-hall decomposition is the middle path. The 10 000 claim must be earned by the benchmark ladder, not assumed.
8. **Benchmark required before claiming scalability:** (a) Approach A oracle vs Approach C **agreement** at 100 and 500 — same optimal `objectiveValue`, both independently valid per the §6.4 acceptance criterion (not candidate-identical); (b) Encoding D vs Encoding C runtime comparison; (c) a successful 4 000 run within its time limit and memory budget; (d) 10 000 attempted only after 4 000 passes, otherwise the §32 scope fallback applies.

---

## 36. Revision 4 — Oracle Agreement and Infeasibility Tiering

1. **Oracle equivalence → oracle agreement (§6.4, §24, §25, §26, §27, §33, §35).** Approach A and Approach C must agree on the optimal `objectiveValue` and both must produce **independently valid** arrangements per the 8-point acceptance criterion in §6.4. Candidate-level or byte-for-byte assignment identity is **not** required — different formulations can yield different optimal arrangements with the same objective, and Approach C's separate stage-2 bijection makes candidate identity invalid as an equivalence criterion. The class→seat pattern may be compared additionally where useful.
2. **Independent-set pre-check is optional, not mandatory (§7.2 C3, §9, §20, §30.5, §33).** The mathematical statement (a class larger than the maximum independent set is infeasible) stands, but the exact computation may itself be expensive. Requirements: `N ≤ S` remains a mandatory cheap check; independent-set bounds are used only if cheap and provably safe for the topology; an exact calculation is **not** performed when not cheap; CP-SAT is the authoritative infeasibility mechanism; no instance is classified `INFEASIBLE` from an unproven heuristic bound. A timeout must never be mis-reported as `CONSTRAINT_CONFLICT`.
3. **Encoding D unchanged.** `Σ_{t∈N(s)} z[t,K] + deg(s)·z[s,K] ≤ deg(s)`, with its equivalence proof to `z[s,K]+z[t,K]≤1` per active-seat edge and per class, is preserved verbatim. The rejected revision-2 formulation was not reintroduced.
4. **Department objective unchanged.** `min Σ o[s,t]` with `o[s,t] ≥ w[s,d]+w[t,d]−1` and the empty-seat correctness argument (§11.4) are preserved.
5. **No implementation.** This revision changed `docs/phase3-cpsat-spec.md` only. No code, dependency, schema, migration, worker, FastAPI, Python, OR-Tools, or Phase 2 file was created or modified. Implementation must not start until the owner approves this revision.

---

## 37. Revision 5 — Production Worker-Count Decision (owner-approved)

1. **`num_search_workers` = 8 is the V1 production default (§12, §15, §28 item 10).** This resolves the previously-proposed worker-count decision.
2. **Basis (500-student benchmark, measured host — 8 logical cores / 4 physical / 23.7 GB RAM):** single worker returned FEASIBLE objective 129 in ≈903 s without proving optimality; 8 workers proved OPTIMAL objective 0 in ≈47 s. Objective value and independent validation — not byte-for-byte assignment identity — are the correctness comparison.
3. **Memory documentation (§12):** Approach A measurements (≈3.64 GB RSS at 500) are benchmark/validation-only and must not be used for production sizing; Approach C + Encoding D (≈1.37 GB RSS at 500) is the production-path figure. Neither figure proves behavior at 4,000 / 10,000 — those need separate benchmarks.
4. **Unchanged:** Approach C model, Encoding D, 8-neighbourhood, classSnapshot hard rule, departmentSnapshot soft objective, seed 42, global hall pool, 60 s default / 3600 s max time limits, timeout status mapping, CP-SAT as the authoritative infeasibility mechanism. Encoding C remains benchmark/research-only.
5. **Deployment assumption recorded:** the 8-worker production configuration assumes the deployment host provides ≥ 8 logical CPU cores. The 500 benchmark was measured on the host above; a host with fewer logical cores invalidates the performance claim until re-validated there. No deployment manifest in the repo declares the production host's CPU/RAM.

---

## 38. Revision 6 — Objective-Reporting Rule (owner-approved, reporting-only)

1. **Empirical discovery (1000-student benchmark, 2026-08-15):** the first 1,000-student production-path run timed out at 120 s and returned FEASIBLE. The reported `objectiveValue` (488) did **not** equal the independently computed `sameDepartmentAdjacentCount` (264). A diagnostic run confirmed the same discrepancy at larger scale (`solver.ObjectiveValue()` 1335 vs three independent counts of 323). Root cause: `o[s,t]` is only **lower-bounded** by the linking constraints, so a FEASIBLE incumbent is not guaranteed to have every auxiliary `o[s,t]` minimized to its tight bound before termination; `solver.ObjectiveValue()` can therefore be inflated on non-same-department edges. The bound is tight at OPTIMAL, which is why 100/500 (both OPTIMAL) never exhibited it.
2. **Owner-approved fix is reporting-only (§5.1, §11, §29):** for FEASIBLE responses `solve_request` reports `objectiveValue = sameDepartmentAdjacentCount(returned assignment)` instead of `round(solver.ObjectiveValue())`; OPTIMAL reporting is unchanged. The raw solver objective is preserved in benchmark diagnostics/evidence. The fixed 1,000 run reported objective 272 == `sameDepartmentAdjacentCount` 272, valid=True, EXIT CODE: 0 (`docs/evidence/phase3-benchmarks/1000-production-8w-fixed.log`).
3. **Explicitly unchanged:** the CP-SAT mathematical objective (`min Σ o[s,t]`, §11), the linking constraints, Encoding D, the validator (§29), Approach C, worker count, seed, and all frozen decisions. The objective-reporting rule is a **documentation of reporting behavior**, not a change to the mathematical model, and the validator is not weakened.
4. **No implementation outside scope:** this revision changes `docs/phase3-cpsat-spec.md` only; the already-shipped solver reporting fix (§5.1) is the owner-approved implementation of this rule. No Prisma, migration, Phase 2, worker, or unrelated file is touched by this revision.