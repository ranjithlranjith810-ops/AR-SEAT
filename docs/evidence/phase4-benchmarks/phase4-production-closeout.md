# Phase 4 — Production Orchestration & End-to-End Seating Generation: Final Report

- Date: 2026-08-15
- Repository: `AR-SEAT` (branch `main`)
- Scope: production orchestration of the frozen CP-SAT engine (seat-label engine), end-to-end seating generation
- Classification: **CASE B — VERIFIED WITH NOTED EXCEPTIONS** (frozen solver modified: **NO**)

Legend: **VERIFIED** = demonstrated by an automated test/run in this session. **MEASURED** = a number recorded from a real run. **IMPLEMENTED** = code added in this phase. **NOT VERIFIED** = exists in the prototype but not proven here (stated honestly, not assumed).

---

## 1. Repository baseline
**VERIFIED.** At start: `HEAD == origin/main == 82670fc`; the only tracked working-tree change was `solver-service/app/main.py` (the `/solve-domain` endpoint added for phase-4 dispatch). Post-work: single commit `ec2a170`, `HEAD == origin/main == ec2a170`.

## 2. Existing module verification
**VERIFIED.** `src/phase4/` (worker pool, solver client, partition/topology, validate/merge, persistence, API), `src/services/exam-document/*` (ingestion: extract, groups, validate, ingest), `solverInput.service`, `solveJob.service`, `prisma/schema.prisma` were inspected before any change. Findings that drove this phase:
- `buildSolverInput` silently selected only `validationStatus: "VALIDATED"` candidates — a silent-drop reconciliation gap (fixed, §4).
- `runGeneration` worker default was hardcoded `2` — now configurable default `4` (§8).
- The Proforma generator rendered a fixed 5×5 grid and **silently omitted** candidates in rows 6+ / columns beyond E — fixed with full-grid pagination (§16).

## 3. Module A — real exam data ingestion
**VERIFIED (existing module) / E2E uses DB fixtures.** The exam-document ingestion module (PDF extraction, multi-subject group segmentation, candidate creation, MATCHED→VALIDATED transitions) pre-exists and is covered by `tests/exam-document.test.ts` and the "phase4 document groups" test. The new E2E (§19) feeds the pipeline with validated candidates created directly in the DB (bulk `createMany`) because per-row service writes over the remote pooler are too slow for 320 candidates; the ingestion→reconciliation hand-off (snapshot vs master) is exercised by the reconciliation tests (§4).

## 4. Ingestion validation — `ERR_CANDIDATE_RECONCILIATION`
**IMPLEMENTED + TESTED.** New `src/phase4/reconcile.ts` runs **before any solver dispatch** and stops the generation with `ERR_CANDIDATE_RECONCILIATION` (job marked FAILED, nothing persisted) when:
- any candidate in the session is not `VALIDATED` (evidence: register number, snapshot value, DB value, reason), or
- a validated candidate's snapshot diverges from its student master `registerNumber` (parsed vs DB evidence).
Wired into `runSeatingGeneration` in `src/phase4/integration.ts`. Tests: `tests/phase4-reconcile.test.ts` (2 gate tests).

## 5. Session partitioning
**VERIFIED.** One `Exam` row = one session boundary (`examDate` + `session` FN/AN). `GenerationResult.session` carries `{ examId, examDate, timeSlot }`; generation scoped to `examId` cannot mix time slots. E2E seats two sessions (FN + AN) with zero cross-session candidate overlap.

## 6. Physical domain rule
**VERIFIED.** `partitionCandidates` builds the physical seat graph and partitions by connected components; each component is one domain (multi-hall when cross-hall edges configured). Seat/edge completeness invariants are re-verified (`verifyPartitionInvariants`). Tests: topology partitioning suite + failure H.

## 7. Composition guard
**VERIFIED.** Pre-dispatch guard per domain (`computeCompositionGuard` mirroring frozen `guards.py`): `INSUFFICIENT_CAPACITY` blocks; `IMBALANCE_RISK` is advisory unless `compositionAction=reject`, which fails with `ERR_DOMAIN_COMPOSITION_IMBALANCE`. Topology ceiling `MAX_DOMAIN_CANDIDATES` is configurable via `limits.maxDomainCandidates` (default 1000). Tests: failure C + failure A.

## 8. Bounded worker pool — default 4, externally adjustable
**IMPLEMENTED + MEASURED.** `src/phase4/config.ts`: `DEFAULT_MAX_PARALLEL_DOMAINS = 4`; override with `SOLVER_MAX_PARALLEL_DOMAINS` (validated integer ≥1). Never hardcoded to 8. Benchmark ran the same 1000-candidate workload at workers 1/2/4/8 (§21).

## 9. Worker failure classification
**IMPLEMENTED + TESTED.** A thrown dispatch (transport/timeout/worker crash) is classified as `FAILED_DOMAIN` with `ERR_DOMAIN_FAILED` — it can no longer drift into a misleading `FAILED_MERGE`. Test: failure E.

## 10. No-partial-publication
**VERIFIED.** A failed/infeasible/invalid generation never writes a plan; `persistValidatedGeneration` is invoked only after final validation, and a persistence failure rolls back and never marks the job SUCCEEDED. Tests: persistence "never publishes anything when a domain is infeasible", all failure tests assert `plan === null`.

## 11. Authoritative validation
**VERIFIED.** Every domain result is re-checked in Node before acceptance: status, assigned==candidate count, unassigned==0, duplicate candidates, duplicate seats, seats outside the domain, objective parity (`reported == validator`). Tests: failure F (duplicate candidate) + G (duplicate seat).

## 12. Merge validation
**VERIFIED.** `validateMerge` rejects partial generations: duplicate candidate/seat ids across domains, foreign seats, missing candidates, shared-hall cross-domain conflict. Tests: merge suite + every COMPLETED generation asserts `merge.valid === true`.

## 13. DB persistence
**VERIFIED.** `persistValidatedGeneration` creates a DRAFT plan + one `SeatAssignment` per candidate in a transaction, then completes the SolveJob (SUCCEEDED, OPTIMAL/FEASIBLE). Tests: persistence suite (plan DRAFT, 160/160 assignments in E2E, job SUCCEEDED).

## 14. Idempotency
**VERIFIED.** `requestSolve` refuses a second active job for the same exam (`jobCreated=false`, `ERR_JOB_ALREADY_ACTIVE`) — the idempotency key is exam/session + generation config. Test: idempotency suite.

## 15. Supersede / regeneration
**VERIFIED.** A new validated generation supersedes the previous non-superseded plan (`SUPERSEDED`) and bumps the version. Test: persistence "supersedes the previous plan".

## 16. Proforma 1
**VERIFIED + IMPROVED.** `generateProforma1` renders hall grids, subject counts, summary page, grand total. **Bug found & fixed:** the grid was fixed 5×5 and silently dropped candidates in larger halls. Now the grid spans the hall's actual rows/columns with 5×5-per-page pagination (labels A..Z, rows continue), so **every candidate is rendered**. Proforma input is built from the persisted plan (`buildProformaInputFromPlan`), never from memory. Test: "phase4 proforma" round-trip.

## 17. PDF round-trip
**VERIFIED.** PDF text extraction (pdfjs) reproduces the persisted assignments exactly — E2E asserts the extracted register-number set equals the persisted plan's set (160/160 per session).

## 18. API contract
**VERIFIED (endpoints) / NOT VERIFIED (auth).** `src/phase4/api.ts` exposes POST `/exam-seating/generations`, GET `/exam-seating/generations/:id`, GET `/exam-seating/generations/:id/seating` (the latter only for a persisted/published plan; `PLAN_NOT_FOUND` otherwise → no partial exposure). **The prototype has no authentication layer; API auth is NOT VERIFIED** and is the primary exception requiring production hardening.

## 19. End-to-end test
**VERIFIED.** `tests/phase4-e2e.test.ts`: 2 sessions (FN/AN), 4 new halls (plus the seeded LH09), 320 candidates across 4 departments, through reconciliation → session identity → partition → stub dispatch → validation → merge → transactional persistence → Proforma 1 → PDF round-trip. Runtime ~13 s. The E2E caught the Proforma pagination defect (§16) and the reconciliation/DB constraints.
*Note:* dispatch is stubbed (deterministic OPTIMAL); the real solver path is measured separately in the §21 benchmark.

## 20. Failure tests A–H (+ reconciliation, idempotency)
**VERIFIED.** `tests/phase4-failure.test.ts` (A oversized component, B insufficient aggregate capacity, C composition reject, D per-domain capacity guard, E worker transport failure, F duplicate candidate, G duplicate seat, H cross-domain adjacency) + `tests/phase4-reconcile.test.ts` + `tests/phase4-persistence.test.ts` (no-partial-publication, supersede). 12 worker/reconcile/idempotency tests + 3 persistence tests all pass.

## 21. Parallel benchmark — 1000 candidates, workers 1/2/4/8 (real CP-SAT)
**MEASURED.** 10 independent halls × 100 seats = 1000 seats, 1000 candidates, 4 departments, 2 years; real frozen solver via uvicorn.

| workers | wallClock ms | sumSolve ms | domains | status | mergeValid | assigned | peak RSS | CPU user+sys ms |
|---|---|---|---|---|---|---|---|---|
| 1 | 49935 | 49447 | 10 | COMPLETED | true | 1000/1000 | 94 MB | 328+110 |
| 2 | 48372 | 47963 | 10 | COMPLETED | true | 1000/1000 | 80 MB | 219+31 |
| 4 | 46492 | 46005 | 10 | COMPLETED | true | 1000/1000 | 81 MB | 156+94 |
| 8 | 48662 | 48263 | 10 | COMPLETED | true | 1000/1000 | 82 MB | 125+0 |

Finding: every domain returns OPTIMAL, merge valid, 1000/1000 assigned at every concurrency. Wall-clock is flat (~46–50 s) because the frozen solver service serializes CPU-bound CP-SAT solves (single uvicorn worker process); the orchestrator is memory-safe and correct at all concurrency, and the conservative default of 4 avoids over-subscription without loss. Model-build time is not separately exposed by the frozen solver (`solverDurationMs` is total), so it is not separately measured — recorded honestly.

## 22. Concurrency safety
**MEASURED.** At workers 1/2/4/8 the same workload completes with zero failed/blocked domains and a valid merge; concurrency is bounded by `mapWithConcurrency` (no unbounded fan-out).

## 23. Memory safety
**MEASURED.** Peak RSS 80–94 MB across all benchmark runs; bounded worker pool keeps per-domain payloads independent.

## 24. Test suite
**MEASURED.**
- `npm test` (isolated `exam_seating_test` DB): **124 passed, 3 skipped** (17 files passed, 1 skipped).
- `npm run typecheck`: **clean**.
- `pytest -q` (frozen solver, `solver-service` venv): **85 passed**.
- Guard parity harness (`scripts/guard-parity.ts` + Python): **10/10** fixtures match (classification, error code, risk violations).

## 25. Evidence
All under `docs/evidence/phase4-benchmarks/`: `phase4-e2e-test.log`, `phase4-worker-failure-tests.log`, `phase4-persistence-test.log`, `phase4-proforma-test.log`, `phase4-parallel-benchmark.log`, `phase4-npm-test.log`, `phase4-pytest.log`, `phase4-typecheck.log`, `phase4-git-status.log`, `phase4-git-diff-stat.log`, `phase4-git-diff-name-only.log`, `phase4-git-log.log` (plus prior module-b logs and this report).

## 26. Git provenance
**VERIFIED.** Single commit `ec2a170` ("feat: phase 4 production orchestration - reconciliation, workers, e2e, failure tests, proforma pagination", 24 files, +4929/−1). Post-commit: `HEAD == origin/main == ec2a170`. Working tree clean of tracked changes; evidence logs and stray files (`docs/phase3-discovery.md`, `"eating prototype✎"`) intentionally left untracked.

## 27. Scope protection
**VERIFIED.** Frozen solver files (`seatlabel.py`, `solver.py`, `graph.py`, `partition.py`, `guards.py`, `validation.py`) unmodified. The only solver-service change is the pre-existing `app/main.py` `/solve-domain` endpoint (a thin dispatch wrapper calling `seatlabel.solve_domain`, with 401/422 guards). No new tables or migrations.

## 28. Stop conditions
**None triggered.** No frozen-solver defect, no capacity ceiling exceeded in production runs, no cross-domain adjacency, no unexpected persistence failure.

## 29. Final acceptance
Met, with the two noted exceptions below. The pipeline never loses a candidate (reconciliation gate + merge completeness + Proforma round-trip), never publishes partial results, bounds parallelism and memory, and is reproducible under real CP-SAT.

## 30. Final classification
**CASE B — VERIFIED WITH NOTED EXCEPTIONS** (frozen solver modified: **NO**).

Noted exceptions (honest, not assumed away):
1. **API authentication is NOT VERIFIED** — the prototype has no auth layer on the phase-4 endpoints (§18); production must add token/role enforcement.
2. **Live PDF→DB ingestion was not re-run end-to-end** in this phase — the E2E seeds validated candidates in the DB (the ingestion module itself pre-exists and is unit-tested; the reconciliation gate validates the ingestion hand-off).

Everything else — reconciliation, session scoping, physical-domain partitioning, guards, bounded workers, failure classification, no-partial-publication, validation, merge, persistence, idempotency, supersede, Proforma 1 (now candidate-complete), PDF round-trip, E2E, failure tests A–H, and the 1000-candidate 1/2/4/8 benchmark — is IMPLEMENTED, TESTED, MEASURED, and VERIFIED.