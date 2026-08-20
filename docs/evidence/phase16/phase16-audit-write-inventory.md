# Phase 16 — Audit Write Inventory

- Phase: Phase 16 (Audit Read Surface — inventory-first)
- Date: 2026-08-17
- HEAD: `d3b6d56` (Phase 14) — parent `433bdbf` (Phase 15)
- Basis: all `logAudit` / `prisma.auditLog` call sites at current HEAD.

## 1. Audit helper

`logAudit(entry: AuditEntry)` (`src/services/audit.service.ts:12`) — a single
awaited `prisma.auditLog.create`. Not transactional with the underlying state
change; failures propagate to the caller. `AuditEntry`:

```ts
{ actorId?: string | null; action: AuditAction; entityType: string;
  entityId: string; metadata?: Prisma.InputJsonValue }
```

## 2. Every audit write at HEAD (19 call sites)

| # | Module:function                  | Action            | entityType          | actorId                        | metadata                                             |
| - | -------------------------------- | ----------------- | ------------------- | ------------------------------ | ---------------------------------------------------- |
| 1 | solveJob:requestSolve            | SOLVE_REQUESTED   | SolveJob            | requestedBy                    | —                                                    |
| 2 | solveJob:startSolve              | SOLVE_STARTED      | SolveJob            | actorId                        | —                                                    |
| 3 | solveJob:completeSolve           | SOLVE_COMPLETED    | SolveJob            | actorId                        | `{ solverStatus }`                                   |
| 4 | solveJob:markInfeasible          | SOLVE_COMPLETED    | SolveJob            | actorId                        | `{ result: "INFEASIBLE" }`                           |
| 5 | solveJob:failSolve               | SOLVE_FAILED       | SolveJob            | actorId                        | `{ errorCode }`                                      |
| 6 | solveJob:cancelSolve             | SOLVE_FAILED       | SolveJob            | actorId                        | `{ reason: "cancelled" }`                            |
| 7 | solveJob:reapStaleJobs           | SOLVE_FAILED       | SolveJob            | (none)                         | `{ errorCode: "WORKER_TIMEOUT" }`                    |
| 8 | seatingPlan:createPlan (in tx)   | PLAN_SUPERSEDED    | SeatingPlan         | createdBy                      | —                                                    |
| 9 | seatingPlan:approvePlan          | PLAN_APPROVED      | SeatingPlan         | approvedBy                     | —                                                    |
| 10| seatingPlan:publishPlan          | PLAN_SUPERSEDED    | SeatingPlan         | publishedBy                    | —   (other PUBLISHED superseded)                     |
| 11| seatingPlan:publishPlan          | PLAN_PUBLISHED     | SeatingPlan         | publishedBy                    | —                                                    |
| 12| seatingPlan:supersedePlan        | PLAN_SUPERSEDED    | SeatingPlan         | actorId                        | —                                                    |
| 13| candidate:createCandidate        | CANDIDATE_MATCHED  | ExamCandidate       | actorId                        | `{ registerNumberSnapshot }`                         |
| 14| candidate:transitionValidationStatus | CANDIDATE_RESOLVED | ExamCandidate     | actorId                        | `{ validationStatus }`                               |
| 15| exam:createExam                  | EXAM_CREATED       | Exam                | actorId                        | —                                                    |
| 16| document:registerDocument        | PDF_UPLOADED       | UploadedExamDocument| actorId                        | `{ fileName, fileSize, fileHash }`                   |
| 17| ingest:upsertCandidate           | CANDIDATE_MATCHED  | ExamCandidate       | actorId                        | `{ sourceDocumentId, fileName }` (only when MATCHED) |
| 18| integration:runGeneration        | SOLVE_STARTED      | SolveJob            | requestedBy                    | `{ phase, generationId }`                            |
| 19| integration:runGeneration        | SOLVE_FAILED       | SolveJob            | requestedBy                    | `{ phase, error, detail }` (reconciliation gate)     |

Files: `src/services/solveJob.service.ts`, `seatingPlan.service.ts`,
`candidate.service.ts`, `exam.service.ts`, `exam-document/document.service.ts`,
`exam-document/ingest.ts`, `src/phase4/integration.ts`.
`src/phase4/persist.ts` imports `logAudit` but never calls it (its audit is
delegated to `completeSolve`/`failSolve`/`markInfeasible`).

## 3. Notable write-path facts

- **All 19 writes are state-changing events.** No GET/read route calls
  `logAudit` anywhere in `src/`.
- **Reuse of actions:** INFEASIBLE completion logs `SOLVE_COMPLETED`; job
  cancellation and stale-reaping log `SOLVE_FAILED`. Existing semantics, unchanged.
- **Transactional vs non-transactional:** `seatingPlan.createPlan` writes
  `PLAN_SUPERSEDED` via `tx.auditLog.create` *inside* the create-plan
  transaction (line 8). Every other write is `logAudit` (non-transactional).
- **Actor identity:** `actorId` comes from the authenticated route actor or the
  worker; `reapStaleJobs` (7) writes with no actor. Role is never stored.
- **Phase 15 `CANDIDATE_RESOLVED` unchanged:** `transitionValidationStatus`
  (`candidate.service.ts:83-102`) still logs exactly one
  `CANDIDATE_RESOLVED` with `{ validationStatus }` — verified at HEAD.

## 4. Does a read surface risk duplicate/extra audit writes?

No. A read-only endpoint only executes `prisma.auditLog.findMany`/`count`/`findUnique`.
It must NOT route through `logAudit` and must NOT reuse any service write
function (e.g. no plan/job/candidate service). A read surface therefore cannot
create duplicate audit writes by construction.

## 5. Conclusion

All existing audit writes are enumerated, state-changing, and untouched. Adding
a read endpoint introduces zero write-path changes.