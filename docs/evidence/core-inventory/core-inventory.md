# AR-SEAT Core Inventory — Ground-Truth Report

**Gate:** Core-Inventory Gate
**Date:** 2026-08-18
**Head:** `d3b6d56` — "feat: add Phase 14 E2E browser harness" (branch `main`; parent `433bdbf`)
**Scope:** Read-only audit. No fixes, no refactors, no schema/API/auth/RBAC/test changes were made by this gate. All inventory was captured from source, schema, migrations, tests, evidence logs, and git state.

Classification legend (each capability classified exactly one of):
`VERIFIED` (works end-to-end, evidenced) · `PARTIAL` (exists but incomplete/unreachable surface) · `MISSING` (absent) · `MOCK-STUB` (mock/stand-in) · `BLOCKED` (impeded) · `UNKNOWN` (not assessable).

---

## 1. Executive Summary

AR-SEAT is a single-tenant prototype: a real seating-generation pipeline that starts from a candidate PDF, extracts register numbers/names, validates them against a persistent **Student master** table, runs a real frozen CP-SAT solver (`solver-service`, Python/ortools) under a bounded parallel dispatch, persists the validated result as a new DRAFT `SeatingPlan` version in one transaction, and supports approve/publish/audit over the published plan.

The backbone is **real and verified**: PDF ingestion, student validation, generation orchestration, persistence, audit, auth/RBAC, and the full frontend are wired to the same `src/phase4/api.ts` surface and covered by ~215 backend tests, 106 frontend tests, and 10 Playwright E2E specs. There are **no mocks, stubs, hardcoded response shims, or TODO placeholders** in the API layer.

The gap is at the **surface**: the intended workflow's first step (STAFF maintaining a Student master) has the schema (`Student`, committed at HEAD) but **no API, no service, no UI**. The same is true for departments, classes, halls, exam creation, and seating-PDF delivery. Gender is stored in the schema and carried in the solver contract but **used in no solver constraint** (no gender split). There is no tenant field and no RLS — auth is application-layer only, which is acceptable for this single-tenant prototype.

---

## 2. Capability Matrix (VERIFIED / PARTIAL / MISSING)

| # | Capability | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Auth + session + RBAC (login/logout/me, requireAuth/requireAdmin) | **VERIFIED** | `src/phase4/api.ts`, `src/auth/`, `frontend/src/auth/`, tests + E2E |
| 2 | PDF upload + storage + parse + extract (register no / name) | **VERIFIED** | `src/services/exam-document/ingest.ts`, `extract.ts`, `tests/phase4-ingestion-e2e.test.ts` |
| 3 | Student-master lookup + validation (MATCHED/VALIDATED/REJECTED) | **VERIFIED** | `validate.ts`, `candidate.service.ts`, API `resolve` route |
| 4 | Duplicate handling (in-doc, in-exam, file hash) | **VERIFIED** | `ingest.ts` sha256 dedup; `validate.ts`; `DocumentParseStatus` |
| 5 | Hall + HallSeat inventory (schema, service, solver input) | **PARTIAL** | `Hall`/`HallSeat` models + `hall.service.ts`; **no API/UI to manage halls**; seeded only |
| 6 | Generation orchestration (partition→guard→dispatch→solve→validate→merge→persist) | **VERIFIED** | `src/phase4/generation.service.ts`, `persist.ts`, `partition.ts`, `validateMerge.ts`, `workerPool.ts` |
| 7 | Solver engine (CP-SAT, adjacency, department/class policy, deterministic) | **VERIFIED** | `solver-service/app/*.py` (frozen), solver tests |
| 8 | Persistence (transactional plan versioning + assignments + SolveJob lifecycle + audit) | **VERIFIED** | `persist.ts` (`$transaction`, SUPERSEDE + DRAFT + createMany), `solveJob.service.ts` |
| 9 | Approval + publish lifecycle | **VERIFIED** | API `approve`/`publish` (ADMIN), `SeatingPlanStatus`, E2E golden-path |
| 10 | Seating output / Proforma-1 PDF generation | **PARTIAL** | `proforma.ts` generates real PDF (pdf-lib); **no download/print route, no UI**; generator tested (round-trip) |
| 11 | Audit log (write on 11 actions; ADMIN read API, sanitized, whitelist) | **VERIFIED** | `audit.service.ts`, Phase 16 API route, `AuditPage.tsx`, Phase 16 tests/E2E |
| 12 | Student master maintenance (CRUD by STAFF) | **MISSING** | `Student` model exists + unique `registerNumber`; **no API, no service, no UI, no test** |
| 13 | Department management | **MISSING** | `Department` model + seed (4 depts); **no API/UI** |
| 14 | Class management | **MISSING** | `Class` model + seed (5 classes); **no API/UI** |
| 15 | Exam creation / management | **PARTIAL** | `exam.service.ts` (createExam/listExams/transition); API has **read-only GET /exams**; creation only via seed/tests |
| 16 | Hall management (CRUD) | **MISSING** | `hall.service.ts` createHall/deriveHallCapacity; **no API/UI** |
| 17 | Gender split (seating separation by gender) | **MISSING** | `Gender` enum in schema + solver contract, but **no constraint/config uses it** |
| 18 | Seating policy configuration (hardRuleScope, policyMode, adjacency) | **PARTIAL** | Solver supports class|department scope and 3 policy modes; Node `solverConfig` exposes only defaults; **no UI/config endpoint** |
| 19 | Bench layout configuration | **PARTIAL** | `hall.service.ts` `seatPositionsFor` auto-derives `A1..A{rows}x{columns}`; **no API/UI to set rows/columns/bench** |
| 20 | Candidate reconciliation gates | **VERIFIED** | `reconcile.ts`, `err` codes, generation refuses stale/mismatched candidates |
| 21 | Test/CI DB isolation + seed discipline | **VERIFIED** | `scripts/run-tests.mjs`, `setup-test-db.mjs`, `tests/helpers.ts`, `.env.example` |

---

## 3. Workflow Status (intended end-to-end path)

| Intended step | Current status |
|---|---|
| STAFF maintains student master (departments/classes/students) | **MISSING** — schema exists, no surface |
| ADMIN creates an exam | **PARTIAL** — `exam.service.ts` exists, no API/UI (seed-only) |
| Upload candidate PDF | **VERIFIED** |
| Parse + extract candidates | **VERIFIED** |
| Verify / resolve students | **VERIFIED** |
| Configure halls + benches | **PARTIAL** — schema+service, no surface |
| Configure seating rules (gender split etc.) | **MISSING** (gender); policy defaults only |
| Generate seating | **VERIFIED** |
| Validate assignments | **VERIFIED** |
| Seating PDF output | **PARTIAL** — generator works, no delivery surface |
| Audit trail | **VERIFIED** |

---

## 4. Ground-Truth Facts

- **Student Master exists (STATE A).** `prisma/schema.prisma` has a committed `Student` model with unique `registerNumber`, FK `classId`, `gender`, `status`, and snapshot-compatible fields. PDF ingest looks students up via `prisma.student` (`validate.ts` `lookupStudents`). `ExamCandidate` stores immutable snapshots (`*Snapshot` columns) — it is not the master.
- **No tenant / school field anywhere.** Single-tenant by design. No `tenant_id`/`school_id`/`organizationId` in schema or src. No RLS policies in any migration (`row level security` / `POLICY` absent from all 3 migrations). Auth enforcement is application-layer (Prisma connects with the app connection string).
- **ExamType is a fixed enum** (`UNIVERSITY | INTERNAL | MODEL`), not extensible without a migration.
- **Only 3 migrations** (`_init`, `exam_doc_dedup`, `add_auth`); all core models are in `_init`. DB is in sync (migrations are the ground truth; Prisma client generated from current schema).
- **Deterministic generation.** `solverConfig.randomSeed` defaults to 0; solver ordering is deterministic; regeneration creates a new DRAFT version and SUPERSEDEs the previous non-superseded plan.
- **No dead weight in API.** `src/phase4/api.ts` contains 15 routes, all real, all RBAC-gated, no stub responses. No TODOs/FIXMEs/XXX markers in src (verified by search).
- **Gender carried but unused.** `solver-service/app/models.py` has `gender: Gender = "OTHER"` but no constraint, guard, partition key, or objective references gender. The Node side's `buildSolverInput` includes `genderSnapshot`; the solver ignores it.
- **Year absent from Node→solver payload.** Solver `Candidate.year` is `Optional`; Node never sends it. Therefore `STRICT_DEPT_OR_YEAR`/`COHORT` policy modes would fail validation (`ERR_INVALID_POLICY_CONFIGURATION`) if enabled; only `DEPARTMENT_ONLY` is viable today.

---

## 5. Status Classification Summary

- **VERIFIED (12):** Auth/RBAC, PDF ingestion, validation, dedup, generation orchestration, solver, persistence, approve/publish, audit, reconciliation, dev/test-DB isolation, frontend connectivity.
- **PARTIAL (5):** Hall inventory, exam management, seating-PDF output, seating-policy config, bench layout.
- **MISSING (6):** Student master maintenance, department management, class management, hall management, gender split, exam-creation surface.
- **MOCK-STUB / BLOCKED / UNKNOWN (0):** none found in the audited surface. (The solver-service is intentionally **frozen**, not a stub.)

---

## 6. Files Produced by This Gate (deliverables)

- `core-inventory.md` (this file)
- `repository-map.md`
- `feature-matrix.md`
- `api-inventory.md`
- `database-inventory.md`
- `security-inventory.md`
- `test-inventory.md`
- `gap-register.md`
- `dependency-map.md`
- `core-inventory-verification.log`
- `git-status.log`, `git-branch.log`, `git-log.log`, `git-diff-stat.log`, `git-diff-name-only.log`

## 7. Gate Integrity

- No source files were modified by this gate. `git status --short` shows only pre-existing uncommitted work (Phase 16, auth fix, dev tooling, evidence). `git diff --name-only` = 15 files, all pre-existing. No `git reset --hard` / `clean` / `checkout .` / `restore .` used.
- No commits, no pushes.
- Full-suite re-run intentionally **not** performed during the inventory (suite takes ~690 s; the last full backend run — Phase 16 closeout — is documented: **215 passed / 3 skipped**, frontend **106/106**, Playwright **10/10**). See `test-inventory.md`.