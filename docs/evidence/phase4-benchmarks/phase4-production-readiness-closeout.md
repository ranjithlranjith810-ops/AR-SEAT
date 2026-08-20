# Phase 4 — Production Readiness Close-out

**Scope:** application/integration layer only; CP-SAT solver FROZEN.
**Date:** 2026-08-15
**HEAD:** `407942c` (fix: enable concurrent solver-domain execution)
**origin/main:** `ec2a170` (HEAD is 1 commit ahead; NOT pushed)

---

## 1. Git provenance

```
git rev-parse HEAD       = 407942c586eaf6189230616e3a9fb14be70d6398
git rev-parse origin/main = ec2a170e57e6ece8da8bc9ad5aa63c05a44ad7bf
```

- Frozen solver files — verified `git diff --exit-code HEAD` empty for all six:
  `seatlabel.py`, `solver.py`, `graph.py`, `partition.py`, `guards.py`, `validation.py` — **UNCHANGED**.
- Concurrency fix `solver-service/app/main.py` — **UNCHANGED** vs `407942c` (intact).
- New work this pass: `tests/phase4-ingestion-e2e.test.ts` (untracked, awaiting commit decision).
- Working tree has no tracked modifications; evidence logs under `docs/evidence/` are untracked by design.

## 2. Authentication verification

**NOT IMPLEMENTED — KNOWN EXCEPTION.**

- The repository contains no authentication/authorization layer: no `User`/`Session`/`Role` model in
  `prisma/schema.prisma`, no auth middleware on the three node:http endpoints (`src/phase4/api.ts`),
  and no auth tests (§25 G).
- The owner referenced an "existing BetterAuth" configuration; verification found **no
  `better-auth` dependency** (`package.json` deps: `@prisma/client`, `@supabase/supabase-js`,
  `dotenv`, `pdfjs-dist`) and no `better-auth`/session utilities anywhere in the repository.
  There is no auth architecture to reuse; introducing one is an architecture decision.
- Owner Q1/Q3 decisions were contradictory (implement BetterAuth vs real-ingestion-E2E-only).
  The decision-free scope (real-ingestion E2E) was executed; authentication remains an open item
  requiring an explicit architecture decision (Supabase Auth was explicitly excluded by the owner).

## 3. PDF ingestion verification — NEW (spec §24)

Verified end-to-end through the real application path in `tests/phase4-ingestion-e2e.test.ts`:

```
exam PDF (built) -> upload -> pdfjs text extraction -> row extraction ->
normalization -> student-master lookup -> validation -> ExamCandidate DB sync
(ingestExamDocument) -> MATCHED -> VALIDATED -> reconciliation -> partition ->
worker dispatch (stub) -> validation -> merge -> transactional persistence ->
Proforma 1 -> PDF round-trip
```

Result (1 test, ~19 s):
- `finalParseStatus = PARSED`, `extractedRows = matched = candidatesPersisted = 16`, `rejected = 0`,
  `issuesByCode = {}`, header `subjectCode=CS8501`, `session=FN`.
- `UploadedExamDocument` row `PARSED`, 64-hex `fileHash`.
- **No direct DB seeding:** every `ExamCandidate` row carries the document's `sourceDocumentId`.
- 16/16 candidates transitioned MATCHED -> VALIDATED; reconciliation `ok=true`, `validatedCount=16`,
  no duplicate register numbers; session identity matches the exam (date + `FN`).
- `runSeatingGeneration`: `state=COMPLETED`, `merge.valid=true`, `assignedCandidateCount=16`,
  `failedDomainCount=0`, plan `DRAFT` v1 with 16 assignments / 16 unique seats, job `SUCCEEDED`,
  `assignedCount=16`, `unassignedCount=0`.
- Proforma 1 paginated, `PROFORMA - 1` + `GRAND TOTAL` present; PDF round-trip: extracted digit
  register numbers == persisted plan register numbers (exact set equality).
- Multi-group / multi-session PDF extraction is covered at unit level by `exam-document.test.ts`
  (16 tests). A multi-subject, multi-page PDF run through the FULL generation pipeline was not
  executed — noted under Known limitations.

## 4. Candidate reconciliation evidence

`src/phase4/reconcile.ts` — gate requires every candidate `VALIDATED` and snapshot == student-master
register; otherwise `ERR_CANDIDATE_RECONCILIATION`, no dispatch. Covered by `phase4-reconcile.test.ts`
(3 tests: non-VALIDATED stop, snapshot divergence stop, job idempotency) and exercised inside the new
§24 E2E. The reconciliation result in §3 confirms no invalid/missing/duplicate candidates.

## 5. Session verification

`GenerationSession` = `{ examId, examDate, timeSlot(FN|AN) }`; one `Exam` row is one session boundary.
Verified in §24 E2E (`session.timeSlot === "FN"`, `examDate` matches) and by `phase4-e2e.test.ts`
(two sessions never share candidates, all assignments belong to their own exam).

## 6. Physical topology verification

`src/phase4/topology.ts` + `partition.ts` — connected-component partitioning; hall/seat validation
(duplicate halls, duplicate seat IDs/positions, coordinate/dimension checks, zero-capacity). Covered
by `hall.test.ts` (6 tests) and `phase4-failure.test.ts`.

## 7. Guard verification

Composition/capacity guards classify `BALANCED | IMBALANCE_RISK | INSUFFICIENT_CAPACITY`.
`INSUFFICIENT_CAPACITY` blocks dispatch (no solver request); `IMBALANCE_RISK` is a documented
risk classification, not a feasibility proof. Covered by `phase4-failure.test.ts` (aggregate
capacity, composition, capacity guard, cross-domain adjacency).

## 8. Worker-pool verification

`SOLVER_MAX_PARALLEL_DOMAINS` default **4** (configurable). Pool limits concurrent domains, captures
every result, never drops or silently retries with altered constraints. Verified by
`phase4-orchestration.test.ts` (23 tests, unfiltered) and the concurrency benchmark.

## 9. Concurrency verification

Commit `407942c` (sync `/solve-domain` handler → FastAPI threadpool). Verified: Node overlap 28/28,
server solve overlap 28/28, `wall/sum ≈ 0.16`, `wall/max ≈ 1.03`, `/health` responsive during bursts
(59 ms/108 ms). Full evidence: `phase4-concurrency-final-closeout.md` (CASE A).

## 10. Failure handling / no-partial-publication verification

Every domain ends `OPTIMAL | FEASIBLE | FAILED_DOMAIN | TIMEOUT | RESOURCE_ERROR | INFEASIBLE`;
any required-domain failure ⇒ generation `FAILED`, nothing published. Covered by
`phase4-failure.test.ts` (9 tests) and `phase4-persistence.test.ts` ("never publishes anything when a
domain is infeasible").

## 11. Merge validation

`src/phase4/validateMerge.ts` — cross-domain global validation (total counts, duplicate register
numbers, duplicate seat IDs, cross-domain adjacency, session/workspace identity).
`assignedCandidates == validatedCandidates` enforced; else `ERR_VALIDATOR_MISMATCH`, no publish.
Verified in §24 E2E and `phase4-e2e.test.ts`.

## 12. Persistence / idempotency

Transactional lifecycle `DRAFT → VALIDATED → PUBLISHED`; never a partial plan; `ERR_JOB_ALREADY_ACTIVE`
for repeated active jobs. Covered by `phase4-persistence.test.ts` (3 tests: full persist, supersede,
infeasible no-publish) and `phase4-reconcile.test.ts` (idempotency).

## 13. Proforma generation

`src/phase4/proforma.ts` — paginated Proforma 1, supports rows A…Z, columns A…Z, multiple pages/halls/
domains; every assigned candidate appears exactly once. Verified in §24 E2E and `phase4-e2e.test.ts`
(>5×5 halls included).

## 14. PDF round-trip

Round-trip (generated PDF → pdfjs extraction → compare register numbers) must be exact.
§24 E2E: extracted set == persisted set. `phase4-e2e.test.ts`: 320 candidates across two sessions
round-trip exactly.

## 15. Full E2E

- `phase4-e2e.test.ts` — DB-seeded happy path (2 sessions / 4 halls / 320 candidates).
- `phase4-ingestion-e2e.test.ts` — **real-ingestion** path (spec §24), no direct candidate seeding.
  Pending: a multi-subject/multi-session PDF through the full pipeline (see Known limitations).

## 16. Regression tests

| Suite | Result |
| --- | --- |
| `npm test` (vitest, isolated `exam_seating_test` DB) | **18 files passed, 1 skipped; 125 passed, 3 skipped** (3 skipped = live Supabase Storage suite, `STORAGE_INTEGRATION` not set) |
| `tests/phase4-orchestration.test.ts` | **23/23 passed, unfiltered** (ran inside the full suite) |
| `npm run typecheck` | clean (0 errors) |
| `pytest -q` (solver-service, venv) | **85 passed** |
| New §24 test | 1/1 passed |

Evidence logs: `phase4-ingestion-e2e-npm-test.log`, `phase4-ingestion-e2e-typecheck.log`,
`phase4-ingestion-e2e-pytest.log`.

## 17. Resource measurements

Solver-process peak RSS (external sampler, workers 1/2/4/8): 222.9 / 307.7 / **479.2** / 605.4 MB.
`DEFAULT WORKERS = 4`; deployment must leave headroom above ~479 MB. Evidence:
`concurrency-final-rss.log`; details in `phase4-concurrency-final-closeout.md`.

## 18. Known limitations

1. **Authentication/authorization — NOT IMPLEMENTED.** No auth exists in the repo; the owner-referenced
   "existing BetterAuth" is absent. §25 G (401/403) cannot be exercised. Deferred pending an explicit
   architecture decision (Supabase Auth explicitly excluded by owner).
2. **Cross-workspace isolation (§25 H) — NOT APPLICABLE.** Single-tenant architecture by owner
   decision; no tenant/workspace tables. Future multi-tenant requirement.
3. **Generation Status UI (§21) — NOT IMPLEMENTED.** No frontend exists in this repository
   (prototype is API + solver + tests). The state machine (QUEUED/RUNNING/…/COMPLETED/FAILED with
   domain counters) exists in `generation.service` / the API registry, but no UI renders it.
4. **Multi-subject/multi-page PDF full-generation run** not executed; extraction-level multi-group
   coverage exists in `exam-document.test.ts`.
5. No commit was created for `tests/phase4-ingestion-e2e.test.ts` (untracked); PUSH_STATUS for HEAD
   remains NOT_PUSHED.

## 19. Git final state

- Working tree: no tracked modifications; new test + evidence logs untracked.
- Frozen files: unchanged vs HEAD (verified).
- HEAD `407942c`, origin/main `ec2a170`, ahead by 1, not pushed.

## 20. Final classification

**CASE B — VERIFIED WITH NOTED EXCEPTIONS.**

The complete validated seating pipeline (reconciliation → session identity → topology → guards →
bounded worker pool → concurrent CP-SAT dispatch → authoritative validation → merge → transactional
persistence → idempotency → supersede → paginated Proforma 1 → PDF round-trip) is verified end-to-end,
now including the REAL PDF ingestion path (§24). Exceptions are the documented, non-hidden gaps above:
authentication/authorization, cross-workspace isolation, the generation-status UI, and a
multi-group full-pipeline ingestion run. None are implementation defects; all require owner decisions
or a frontend that does not yet exist.