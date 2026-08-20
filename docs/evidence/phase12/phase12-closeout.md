# Phase 12 — DRAFT Seating Read Auditability (CLOSED — CASE B)

Date: 2026-08-17
Decision: **CASE B — NOT SUPPORTED CLEANLY** (STOP, no production changes)

## Objective

Determine whether reads of DRAFT seating plans through
`GET /exam-seating/plans/:seatingPlanId` are audit-logged using the existing
audit architecture.

## Result

They are not audited, and the existing architecture cannot represent a
DRAFT-seating READ without a schema change. The `AuditAction` column is a closed
Postgres enum of state-changing events only; adding a READ action requires a
migration, and role is not captured on audit rows. Per the phase boundary this is
a STOP; no production code was changed and no implementation was performed.
Full detail in `docs/evidence/phase12/audit-architecture-inventory.md`.

## Permission model

Verified unchanged (this phase did not touch permissions):

| Capability              | ADMIN | STAFF |
| ----------------------- | ----: | ----: |
| Read DRAFT seating plan |   YES |   YES |
| Approve plan            |   YES |    NO |
| Publish plan            |   YES |    NO |
| Generate seating        |   YES |    NO |
| Upload document         |   YES |    NO |

## Closeout classification table

| Item                                 | Classification          |
| ------------------------------------ | ----------------------- |
| Audit architecture inventory         | VERIFIED                |
| DRAFT STAFF read audit behavior      | DEFERRED (CASE B)       |
| DRAFT ADMIN read audit behavior      | DEFERRED (CASE B)       |
| Successful-read-only audit semantics | NOT APPLICABLE (no impl)|
| Failed-read no-audit semantics       | NOT APPLICABLE (no impl)|
| Audit actor attribution              | VERIFIED (actorId supported; role not stored) |
| Audit resource attribution           | VERIFIED (entityType/entityId) |
| Audit duplication prevention         | NOT APPLICABLE (no impl)|
| Audit content safety                 | NOT APPLICABLE (no impl)|
| Audit failure semantics              | VERIFIED (existing helper: awaited create; failures propagate) |
| Existing permission model            | VERIFIED                |
| Phase 11 approve/publish regression  | NOT APPLICABLE (no code changed) |
| Publication race                     | NOT APPLICABLE (no code changed) |
| PLAN_NOT_FOUND semantics             | NOT APPLICABLE (no code changed) |
| Frozen solver                        | VERIFIED (diff exit 0)  |
| Full npm suite                       | NOT VERIFIED (not run; no production changes) |
| Frontend regression                  | NOT VERIFIED (not run; no frontend changes) |
| Root typecheck                       | NOT VERIFIED (not run; no code changed) |

## STOP conditions encountered

- STOP (Rule 0.3 / condition 1): supporting READ audit requires a new
  `AuditAction` enum value -> Prisma migration (schema redesign). Recorded as
  CASE B; no speculative workaround attempted.

## Evidence

- `docs/evidence/phase12/audit-architecture-inventory.md`
- `docs/evidence/phase12/phase12-closeout.md`
- `docs/evidence/phase12/phase12-git-log.log` (fresh)
- `docs/evidence/phase12/phase12-head.log` (fresh)
- `docs/evidence/phase12/phase12-origin-main.log` (fresh)
- `docs/evidence/phase12/phase12-git-status.log` (fresh)
- `docs/evidence/phase12/phase12-frozen-diff.log` (fresh)

## Follow-ups (genuinely unresolved)

1. Audit-read support (new enum value / access-event model + optional role column)
   — recommended as a separate reviewed backend task.

## Boundary note

This phase answers only: *Is DRAFT seating read appropriately auditable using the
existing architecture?* — No (CASE B). It does not decide whether every GET
should be audited, whether STAFF should see DRAFT plans (unchanged: yes), or
whether to build an audit dashboard.

## Git discipline

No commit. No push. No production files changed.