# AR-SEAT Gap Register

Every gap below was confirmed from source (schema, `src/phase4/api.ts`, services, frontend routes). P0 = blocks the product; P1 = required for the intended workflow; P2 = important; P3 = hardening/hygiene.

## P0 — blocking

**None.** The core seated-exam pipeline (upload → validate → generate → approve → publish → audit) is end-to-end verified and working.

## P1 — required for the intended workflow

| ID | Gap | Evidence | Notes |
|---|---|---|---|
| G-01 | **Student master maintenance surface** (CRUD for STAFF) | `Student` model exists (`schema.prisma`, unique `registerNumber`); **no service, no API route, no UI, no test** | The intended workflow starts with STAFF maintaining the master. Schema (STATE A) is already present and used by `validate.ts lookupStudents`; only the surface is missing. |
| G-02 | **Exam creation surface** | `exam.service.createExam`/`listExams` exist; API exposes only read `GET /exams`; frontend has only `ExamsPage` (list) | Admins currently cannot create an exam outside seed/tests. |
| G-03 | **Department management surface** | `Department` model + 4 seeded; no API/UI | Needed to seed/build classes; G-01 depends on it. |
| G-04 | **Class management surface** | `Class` model + 5 seeded; no API/UI | Students FK to classes. |
| G-05 | **Hall management surface** | `hall.service.ts` (createHall, deriveHallCapacity, seatPositionsFor, setHallSeatActive) exists; **no API route, no UI** | Halls are seeded only; generation depends on active halls in solver input. |
| G-06 | **Seating PDF delivery** | `proforma.ts` generates real Proforma-1 PDF (pdf-lib), generator round-trip tested; **no download route, no UI link** | Output of the whole system is currently undiscoverable. |
| G-07 | **Gender split** | `Gender` enum in schema + candidate snapshot + solver contract; solver has **zero** gender-based constraints | Capability is entirely absent (see gap-register / gender-split spec). |

## P2 — important

| ID | Gap | Evidence |
|---|---|---|
| G-08 | Seating-rule configuration (hardRuleScope class/department, policyMode, adjacency) | Solver supports all options; Node `solverConfig` sends defaults only; no config endpoint/UI. Also `STRICT_DEPT_OR_YEAR`/`COHORT` need `year` which Node never sends — would hit `ERR_INVALID_POLICY_CONFIGURATION`. |
| G-09 | Bench layout configuration | `hall.service.seatPositionsFor` derives `A1..A{rows}x{columns}` automatically; no API/UI to set rows/columns/bench per hall. |
| G-10 | `ExamStatus` lifecycle unreachable | `exam.service.ALLOWED_TRANSITIONS` exists; no production caller transitions exams beyond DRAFT (generation updates `SeatingPlan.status`, not `Exam.status`). |
| G-11 | Student bulk import | No import path; only seed + per-PDF student creation. |
| G-12 | CandidatePage retry for pending/queued generations | Frontend lacks a retry affordance (queue exists via SolveJob). |
| G-13 | Frontend pages for admin-only outputs | No UI for plan PDF output, hall view, or policy config. |

## P3 — hardening / hygiene

| ID | Gap | Evidence |
|---|---|---|
| G-14 | Predictable seed credentials (admin/staff) | `scripts/e2e/seed.mjs` / dev seed; fine for prototype, must harden before any real deployment. |
| G-15 | No login rate-limiting | `src/auth/*` has none. |
| G-16 | Fixed `ExamType` enum (UNIVERSITY/INTERNAL/MODEL) | Not extensible without migration; if exam types need behavior/config, needs schema work. |
| G-17 | RLS / tenant isolation | None by design (single-tenant). Revisit when multi-tenancy is considered. |
| G-18 | Junk file `eating prototype•` untracked at repo root | Leftover; safe to delete (not part of this gate). |
| G-19 | Dead code: `proforma.ts`, `hall.service`, `seatAssignment.service`, several exports are unused/test-only | Real but unreachable; keep as foundation for G-06/G-05/G-11 rather than delete. |
| G-20 | `StudentStatus` lacks HAS_ARREAR/DISCONTINUED | If arrears/backlog filtering is required later, enum needs migration. |

## Recommended next phase (proposal only — requires approval)

**Phase 17 — Student Master foundation + management surfaces (P1 bundle):** add API + services + STAFF/ADMIN UI for `Student` (and the Department/Class groundwork it depends on) on top of the existing schema, with tests mirroring existing suite structure. Candidate snapshots already reconcile against the master. This unblocks the intended workflow's first step and is the highest-leverage next increment. Alternatively Phase 17 = exam creation + seating-PDF delivery if the team prefers output-facing value first.