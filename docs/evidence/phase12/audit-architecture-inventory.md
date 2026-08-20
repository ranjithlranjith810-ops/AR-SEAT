# Phase 12 — Audit Architecture Inventory

Date: 2026-08-17
Phase 12 — DRAFT Seating Read Auditability (inventory-first, no production changes)

## 1. Audit model / table

`model AuditLog` -> table `audit_logs` (`prisma/schema.prisma:332-345`):

| Field        | Type                    | Notes                                  |
| ------------ | ----------------------- | -------------------------------------- |
| id           | String @id @default(uuid()) |                                       |
| actorId      | String?                 | nullable; no FK to users               |
| action       | AuditAction             | NOT NULL, Postgres enum                |
| entityType   | String                  | e.g. "SeatingPlan"                     |
| entityId     | String                  | plan id / job id / etc.                |
| metadata     | Json?                   | optional                               |
| createdAt    | DateTime @default(now())| DB-generated timestamp                 |

Indexes: `[entityType, entityId]`, `[action]`, `[actorId]`.

## 2. Audit action enum

`enum AuditAction` (`prisma/schema.prisma:88-100`) — closed Postgres enum created in
`prisma/migrations/20260812132538_init/migration.sql:32`:

```
PDF_UPLOADED, CANDIDATE_MATCHED, CANDIDATE_RESOLVED, EXAM_CREATED,
SOLVE_REQUESTED, SOLVE_STARTED, SOLVE_COMPLETED, SOLVE_FAILED,
PLAN_APPROVED, PLAN_PUBLISHED, PLAN_SUPERSEDED
```

All ten values are **state-changing** operations. **No READ event exists.**

## 3. Audit helper

`logAudit(entry: AuditEntry)` (`src/services/audit.service.ts:12`):

```ts
export interface AuditEntry {
  actorId?: string | null;
  action: AuditAction;          // typed as the Prisma enum — closed set
  entityType: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
}
```

Implementation is a single awaited `prisma.auditLog.create`. Not transactional
with the underlying state change; failures propagate to the caller.

## 4. All existing call sites (27), all state-changing

- `src/services/solveJob.service.ts` (8) — SOLVE_REQUESTED/STARTED/COMPLETED/FAILED/CANCELLED lifecycle
- `src/services/seatingPlan.service.ts` (4) — PLAN_APPROVED / PLAN_PUBLISHED / PLAN_SUPERSEDED
- `src/services/candidate.service.ts` (2) — CANDIDATE_MATCHED / CANDIDATE_RESOLVED
- `src/phase4/integration.ts` (2) — SOLVE_REQUESTED / SOLVE_STARTED
- `src/services/exam-document/document.service.ts` (1) — PDF_UPLOADED
- `src/services/exam-document/ingest.ts` (1)
- `src/services/exam.service.ts` (1) — EXAM_CREATED
- `src/phase4/persist.ts` (import; used in the persistence/validation flow, not reads)

No GET/read route calls `logAudit` anywhere in `src/`.

## 5. Existing approve/publish audit pattern (Phase 11)

- `approvePlan` (`seatingPlan.service.ts:69-83`): status update -> `logAudit({ action: "PLAN_APPROVED", entityType: "SeatingPlan", entityId: id, actorId: approvedBy })`.
- `publishPlan` (`seatingPlan.service.ts:85-116`): supersede other PUBLISHED -> status update -> `logAudit({ action: "PLAN_PUBLISHED", ... })`.
- Tests locate records via `prisma.auditLog.findFirst({ where: { action, entityType: "SeatingPlan", entityId } })` and assert `actorId` (`tests/phase11-publish-approve.test.ts:171,210`).
- Actor identity: `actorId` from the authenticated route actor (`requireAdmin` user id). Role is NOT stored on the audit row (resolvable via users table only).
- Timestamps: DB-generated.
- Failure semantics: audit create is awaited and NOT in a transaction; a failing audit write after the status update would persist the state change but fail the HTTP request at the generic 500 boundary.

## 6. Target read path trace

```
GET /exam-seating/plans/:seatingPlanId
  -> api.ts planMatch block: requireAuth(user)
  -> getSeatingPlanById (src/phase4/persist.ts:185)
       -> prisma.seatingPlan.findUnique({ where: { id }, include: SEATING_PLAN_INCLUDE })
       -> throws SeatingError PLAN_NOT_FOUND if missing
  -> serializeSeating -> 200 { plan }
```

The route performs **no audit call**. `getSeatingPlanById` is shared with the
approve/publish response refetch, so auditing inside the helper would double-audit
(READ + action) on those requests.

## 7. Classification

### CASE B — NOT SUPPORTED CLEANLY

Supporting a DRAFT-seating READ audit requires:

1. A **new `AuditAction` enum value** (e.g. `SEATING_PLAN_READ`/`PLAN_READ`) —
   `action` is a closed Postgres enum (`AuditAction NOT NULL`); adding a value
   requires a Prisma schema change and a migration (`ALTER TYPE "AuditAction"
   ADD VALUE ...`). This is an explicit STOP trigger (Rule 0.3: "a new enum").
2. **Role representation** — the audit model stores `actorId` only; §8.1 of the
   phase spec requires `role` to be represented, which the current schema cannot
   do without a new column (another schema change).

Both are architectural changes to a system currently scoped to state-changing
operations. Per the phase boundary this is a STOP; no production code is changed.

### AUDIT READ SUPPORT: NOT CURRENTLY SUPPORTED

## 8. Future-work recommendation (separate reviewed backend task)

A dedicated audit-architecture task could add:
- a read/access action (e.g. `PLAN_READ`) via a Prisma migration, or
- a generic access-event model decoupled from the state-change enum,
- optionally an `actorRole` column,
- explicit audit-failure policy (fail-open vs fail-closed).

This is explicitly outside Phase 12 scope.