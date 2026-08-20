# Phase 16 — Audit Schema Inventory

- Phase: Phase 16 (Audit Read Surface — inventory-first)
- Date: 2026-08-17
- HEAD: `d3b6d56` (Phase 14 E2E harness) — parent `433bdbf` (Phase 15)
- Inventory basis: current Prisma schema at HEAD, `prisma/schema.prisma`.
- No schema changes were made during this inventory.

## 1. `model AuditLog` -> table `audit_logs` (`prisma/schema.prisma:332-345`)

| Field      | Type                   | Null | Notes                                             |
| ---------- | ---------------------- | ---- | ------------------------------------------------- |
| id         | String @id @default(uuid()) | no  | UUID                                            |
| actorId    | String?                | yes  | No FK to `users`; free string                    |
| action     | AuditAction            | no   | Postgres enum (`AuditAction NOT NULL`)           |
| entityType | String                 | no   | e.g. "SeatingPlan", "SolveJob", "ExamCandidate"   |
| entityId   | String                 | no   | plan id / job id / candidate id / ...            |
| metadata   | Json?                  | yes  | Prisma `Json` (nullable)                          |
| createdAt  | DateTime @default(now()) | no  | DB-generated timestamp                            |

Indexes:

```
@@index([entityType, entityId])
@@index([action])
@@index([actorId])
```

No index on `createdAt` (ordering-only queries have no supporting index today).
No partial index, no composite `(createdAt, ...)` index.

## 2. `enum AuditAction` (`prisma/schema.prisma:88-100`)

Closed Postgres enum created in `prisma/migrations/20260812132538_init/migration.sql`.
Ten values, all state-changing:

```
PDF_UPLOADED, CANDIDATE_MATCHED, CANDIDATE_RESOLVED, EXAM_CREATED,
SOLVE_REQUESTED, SOLVE_STARTED, SOLVE_COMPLETED, SOLVE_FAILED,
PLAN_APPROVED, PLAN_PUBLISHED, PLAN_SUPERSEDED
```

**No READ/access action exists.** Adding one requires
`ALTER TYPE "AuditAction" ADD VALUE ...` (a migration).

## 3. Related model: `User` (`prisma/schema.prisma:347-358`)

`actorId` on an audit row is a free string; it is not a FK. To present the actor's
username/role, a read surface must resolve `actorId -> users.username / users.role`
(`UserRole` enum: `ADMIN | STAFF`). The audit row itself stores no role.

## 4. Migrations history

```
20260812132538_init            (AuditLog table + AuditAction enum created)
20260813090000_exam_doc_dedup  (upload dedup — no AuditLog change)
20260815170000_add_auth        (User/AuthSession — no AuditLog change)
```

No migration has touched `audit_logs` since the initial creation.

## 5. Existing vs required vs missing capability

| Capability                                   | Existing | Required | Missing                    |
| -------------------------------------------- | -------- | -------- | -------------------------- |
| Store action / entity / actor / timestamp    | Yes      | Yes      | —                          |
| Query by entityType+entityId                 | Yes (idx)| Yes      | —                          |
| Query by action                              | Yes (idx)| Maybe    | —                          |
| Query by actorId                             | Yes (idx)| Maybe    | —                          |
| Query by createdAt range                     | Yes (scan) | Maybe | index only if justified    |
| Deterministic order by createdAt desc        | Possible| Yes      | index for large volumes    |
| Resolve actor username / role                | Via users| Optional| —                          |
| Store role on the audit row                  | No       | No (resolvable) | would need a column |
| READ / access audit action                   | No       | No       | see read-audit decision    |
| Retention / TTL policy                       | None     | None req.| —                          |

## 6. Conclusion (schema)

A controlled ADMIN audit-READ surface is **supported by the current schema
without any migration**:

- All read filters that matter (entityType/entityId, action, actorId) are indexed.
- `createdAt` ordering works today; an index is only a scale/latency question
  (see Performance in the design decision), never a correctness blocker.
- Actor identity is resolvable via `users` (username, role).
- The closed `AuditAction` enum does not block reading existing records.

**Classification: NO MIGRATION REQUIRED for a read-only surface.**
Any decision to add `AuditAction.READ` or an `actorRole` column would be a
separate, explicitly-approved schema change.