# Phase 16 — Read-vs-Read-Audit Decision

- Phase: Phase 16 (Audit Read Surface — inventory-first)
- Date: 2026-08-17
- HEAD: `d3b6d56` (Phase 14) — parent `433bdbf` (Phase 15)
- Status: **INVENTORY COMPLETE — implementation gate NOT crossed.**
  This document records the decision and the proposed contract; no code changed.

## 1. The decision question

> Is the requirement to **read audit logs**, or to **audit the act of reading audit logs**?

- The Phase 16 objective is: "a controlled ADMIN audit-read surface that allows
  authorized users to inspect audit history without changing existing
  audit-write behavior." That is an **audit-log viewer**.
- The requirement does not ask for access/governance logging of reads.
- Repo precedent: every existing read route (`GET /exam-seating/exams`,
  `/plans/:id`, `/generations/:id`, `/documents/:id/candidates`) performs no
  audit write. The audit trail is consistently scoped to **state-changing**
  operations.

## 2. Conclusion: does reading need an `AuditAction.READ`?

**NO.**

- `AuditAction` is a closed Postgres enum; adding `READ` requires a migration
  (`ALTER TYPE ... ADD VALUE`). There is no requirement that justifies it.
- Auditing every read would cause unbounded write amplification with no stated
  compliance need.
- If governance access-logging of audit reads is ever required, that is a
  **separate design decision** (recommended: a dedicated access-event model
  decoupled from the state-change enum, or a distinct `AUDIT_LOG_READ` action
  added by an explicitly approved migration) — never something inferred into
  this phase.

**Therefore: NO schema change; NO `AuditAction.READ`; NO new column.**

## 3. Proposed read contract (pending approval)

The smallest contract that answers "which events, on which entity, when, by whom".

- **Endpoint:** `GET /exam-seating/audit-logs`
- **HTTP method:** GET (read-only; no body semantics)
- **Authorization:** unauthenticated → `401 UNAUTHORIZED`; `STAFF` → `403 FORBIDDEN`; `ADMIN` → allowed. Backend authorization is authoritative; follows existing `requireAuth`/`requireAdmin` conventions in `src/phase4/api.ts`.
- **Pagination:** offset-style consistent with the existing Phase 9/10 candidate pagination (the repo has no cursor conventions). Query params `limit` + `offset`; default `limit` 20; maximum `limit` 100; `limit` outside bounds rejected or clamped to max; deterministic ordering by `createdAt DESC, id DESC` (tie-breaker for identical timestamps).
- **Filters (validated, bounded):** optional `action` (must be a valid `AuditAction`), `entityType`, `entityId`, `actorId`, `from`/`to` (ISO timestamps). Unknown/invalid filter values → `400` with a safe message. No free-text search.
- **Response shape:** `{ items: AuditLogItem[], total, limit, offset }`. `total` from a bounded `prisma.auditLog.count` with the same filter.
- **`AuditLogItem` serialization (approved public fields only):**
  - `id`, `action`, `entityType`, `entityId`, `createdAt`
  - `actor`: `{ id, username, role }` resolved via `users` when `actorId` is present, else `null` — **never expose** `passwordHash`, `email` (not required), or raw internal rows.
  - `metadata`: expose **only on explicit approval** — current metadata payloads contain no secrets (fileHash, errorCode, validationStatus), but the safe default is to omit or field-whitelist; do not echo `metadata` verbatim without review.
- **Error behavior:** consistent with the sanitization contract — `401/403/400`, plus intentional `404` where an entity is absent; no stack traces, no internals (`api-error-sanitization.test.ts` conventions).
- **Performance:** `entityType+entityId`, `action`, `actorId` filters are indexed. A pure time-ordered listing has no `createdAt` index today; at local/test volumes this is fine, and a `createdAt` index is **only** considered if a measured need appears (documented before any schema change).

## 4. Authorization verification (repo conventions)

- `src/phase4/api.ts` uses cookie-session auth (`requireAuth`) and
  `requireAdmin`/role checks for protected mutations (e.g. approve/publish,
  resolve, upload). The audit-read route will follow the same `requireAuth`
  + role gate. Confirmed: STAFF is denied resolve/generate/approve/publish;
  admin-only reads already exist (e.g. exam list is ADMIN-only in Phase 10).
- Frontend hiding is not a security control; the backend gate is authoritative.

## 5. Data-exposure review summary

Safe to expose: `id`, `action`, `entityType`, `entityId`, `createdAt`, and
resolved `actor.{id,username,role}`.
Never exposed directly: `Prisma` rows, `passwordHash`, internal error details,
`fileHash`/`storagePath` unless whitelisted, and `metadata` only by explicit
whitelist after review.

## 6. API implementation gate checklist

| Question                                 | Answer (this inventory)                |
| ---------------------------------------- | -------------------------------------- |
| What records are exposed?                | `audit_logs` state-change events       |
| Who can read them?                       | ADMIN only (401/403 otherwise)         |
| Does reading itself need auditing?       | No                                     |
| Is `AuditAction.READ` required?          | No                                     |
| What fields are serialized?              | Approved public set (§3)               |
| How is pagination handled?               | limit/offset, default 20, max 100, deterministic order |
| What filters exist?                      | action, entityType, entityId, actorId, date range |
| What data is sensitive?                  | metadata (default omit), actor internals |
| Is a migration required?                 | NO                                     |
| Is a new index required?                 | Not required (optional later)          |

All questions are resolved. Implementation may proceed **only after this
inventory is approved**; per Phase 16 §25 no code is written until then.

## 7. Deferred (unchanged)

Academic-year/class-context, truly-unmatched candidate resolution, solver:
unchanged. No Phase 14/15 behavior is affected by this decision.