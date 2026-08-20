# AR-SEAT Feature Matrix

Source of truth: `src/phase4/api.ts` (the only HTTP surface), `frontend/src/App.tsx` + components, and services. Row = feature; columns = backend service, API route, frontend page, test coverage, status.

## Auth & RBAC

| Feature | Backend | API | Frontend | Tests | Status |
|---|---|---|---|---|---|
| Login / logout / session | `src/auth/*` | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | `LoginPage`, `AuthProvider` | `e2e/specs/auth.spec.ts` (3), `frontend AuthAndLogin.test.tsx` | **VERIFIED** |
| ADMIN gate | `requireAdmin` guard | all ADMIN routes | nav hides admin items for STAFF | `e2e/specs/role-gating.spec.ts` (3) | **VERIFIED** |

## Exams

| Feature | Backend | API | Frontend | Tests | Status |
|---|---|---|---|---|---|
| List exams | `exam.service.listExams` | `GET /exam-seating/exams` (ADMIN) | `ExamsPage` | unit tests | **VERIFIED** |
| Create exam | `exam.service.createExam` | **no route** | **none** | unit tests only | **PARTIAL** (seed/test-only) |
| Exam lifecycle transitions | `exam.service.transitionExamStatus` | **no route** | **none** | unit tests | **PARTIAL** |
| Exam type (UNIVERSITY/INTERNAL/MODEL) | enum only; no per-type behavior | — | — | — | **PARTIAL** (fixed enum) |

## PDF ingestion

| Feature | Backend | API | Frontend | Tests | Status |
|---|---|---|---|---|---|
| Upload PDF | `exam-document/ingest.ts` | `POST /exam-seating/documents?examId=` (ADMIN, %PDF magic, 20 MB) | `UploadPage` | `tests/phase4-ingestion-e2e.test.ts` + unit | **VERIFIED** |
| Storage | Supabase (live) / memory (test) | — | — | storage-integration (3, skipped w/o `STORAGE_INTEGRATION=1`) | **VERIFIED** |
| Parse + extract (Anna University table config) | `extract.ts`, `normalize.ts` | — | — | extract tests | **VERIFIED** |
| Dedup (sha256, in-doc, in-exam) | `ingest.ts`, `validate.ts` | — | — | unit | **VERIFIED** |
| Document status page | — | `GET /exam-seating/documents/:id` | `DocumentStatusPage` | unit | **VERIFIED** |

## Student validation

| Feature | Backend | API | Frontend | Tests | Status |
|---|---|---|---|---|---|
| Lookup against Student master | `validate.ts lookupStudents` | — | — | unit | **VERIFIED** |
| Validation issues + status | `validate.ts`, `candidate.service` | — | — | unit | **VERIFIED** |
| Resolve / transition (MATCHED→VALIDATED/REJECTED) | `candidate.service.transitionValidationStatus` | `POST .../documents/:docId/candidates/:candidateId/resolve` (ADMIN) | `CandidatePage` | unit + E2E golden-path | **VERIFIED** |
| List candidates | — | `GET /exam-seating/documents/:id/candidates` | `CandidatePage` | unit | **VERIFIED** |

## Halls & benches

| Feature | Backend | API | Frontend | Tests | Status |
|---|---|---|---|---|---|
| Hall inventory (schema+service) | `hall.service.ts` createHall/deriveHallCapacity/seatPositionsFor | **no route** | **none** | unit tests | **PARTIAL** |
| Hall CRUD surface | — | **missing** | **none** | — | **MISSING** |
| Bench layout config (rows/columns) | service-level only | **missing** | **none** | — | **PARTIAL** |

## Generation

| Feature | Backend | API | Frontend | Tests | Status |
|---|---|---|---|---|---|
| Build solver input | `solverInput.service.ts` | — | — | unit | **VERIFIED** |
| Partition / guard / dispatch / solve | `partition.ts`, `workerPool.ts`, generation.service | — | — | unit + solver tests | **VERIFIED** |
| Validate + merge + persist (tx) | `validateMerge.ts`, `persist.ts` | — | — | unit | **VERIFIED** |
| Generate (ADMIN) | `generation.service` + integration | `POST /exam-seating/generations` | `GenerationPage` | unit + E2E | **VERIFIED** |
| Generation detail + seating | — | `GET /generations/:id`, `GET /generations/:id/seating`, `GET /plans/:seatingPlanId` | `GenerationPage`, `SeatingPlanPage` | unit | **VERIFIED** |
| Approve / publish | `seatAssignment`/plan services | `POST /plans/:id/approve`, `/publish` (ADMIN) | `SeatingPlanPage` | unit + E2E golden-path | **VERIFIED** |
| Gender split | **no constraint in solver** | — | — | — | **MISSING** |
| Seating policy config (scope/mode/adjacency) | solver supports; Node sends defaults only | **no route/UI** | — | solver unit | **PARTIAL** |

## Seating PDF

| Feature | Backend | API | Frontend | Tests | Status |
|---|---|---|---|---|---|
| Proforma-1 PDF generator | `proforma.ts` (pdf-lib, register no + department) | **no route** | **none** | round-trip tests | **PARTIAL** |
| Download / print surface | — | **missing** | **none** | — | **MISSING** |

## Audit

| Feature | Backend | API | Frontend | Tests | Status |
|---|---|---|---|---|---|
| Write audit on 11 actions | `audit.service.logAudit` + whitelist | — | — | unit | **VERIFIED** |
| Read audit log (sanitized, paged) | serializer whitelist | `GET /exam-seating/audit-logs` (ADMIN, Phase 16) | `AuditPage` | `tests/phase16-audit-read.test.ts` + `e2e/specs/audit-read.spec.ts` (3) | **VERIFIED** |

## Student / Department / Class maintenance

| Feature | Backend | API | Frontend | Tests | Status |
|---|---|---|---|---|---|
| Student master CRUD | **none** (schema only) | **missing** | **none** | — | **MISSING** |
| Department CRUD | **none** | **missing** | **none** | — | **MISSING** |
| Class CRUD | **none** | **missing** | **none** | — | **MISSING** |

## Summary

- **VERIFIED surfaces:** auth, exams-list, PDF upload, document status, candidates, generate, plan view, approve/publish, audit, and full frontend connectivity.
- **MISSING surfaces (schema/engine already present):** Student master maintenance, department/class management, hall management, exam creation, seating-PDF delivery, gender split, policy configuration.
- **Zero** frontend screens exist for student/department/class/hall management, exam creation, PDF output, or gender config — the frontend's nav is exactly: Home, Exams, Upload documents, Audit log (admin-only).