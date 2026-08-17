# Phase 9 — Product Permission Matrix

Status: CURRENT (verified via tests + HTTP traces) vs DEFERRED (no route exists today; future intent only).
Date: 2026-08-16 (updated during Phase 9 pre-commit verification, Step 3)

## Rules

1. Two roles exist in the auth model: `ADMIN`, `STAFF` (`UserRole` enum; `requireRole` in `src/phase4/auth/guards.ts`). Every endpoint declares `requireAuth` / `requireAdmin` / `requireRole` explicitly.
2. The ADMIN-only generation rule is intentional and must not silently change during Phase 9.
3. A capability is only marked "IMPLEMENTED" when a route exists and its behavior is verified. A capability with no HTTP route has **current** behavior = `404 NOT_FOUND` for every method/path attempted.
4. **Wording rule:** never write "STAFF → 403" for a capability whose route does not exist. "STAFF → 403" is a **future** contract that applies only once the route is built. Current behavior for a missing route is `404 NOT_FOUND` regardless of role.
5. The matrix is the single authoritative table; permissions are not inferred per-route.

## Current (implemented, verified)

| Capability                 | ADMIN    | STAFF    | Evidence |
| -------------------------- | -------- | -------- | -------- |
| Login / session            | ✓        | ✓        | LOCKED — existing auth, both roles (Phases 4–5 tests). |
| Upload exam/student PDF    | ✓ ALLOWED| — FORBIDDEN (403) | IMPLEMENTED — `POST /exam-seating/documents` requires ADMIN (`requireAdmin`); STAFF gets `403 FORBIDDEN` (phase9-upload.test.ts). |
| View ingestion status      | ✓ ALLOWED| ✓ ALLOWED| IMPLEMENTED — `GET /exam-seating/documents/:id` requires auth only (`requireAuth`); both roles verified `200` (phase9-upload.test.ts). |
| View validated candidates  | ✓ ALLOWED| ✓ ALLOWED| IMPLEMENTED — `GET /exam-seating/documents/:id/candidates` requires auth only; both roles verified `200`, paginated, master-sourced snapshots (phase9-upload.test.ts). |
| Start seating generation   | ✓        | —        | LOCKED — existing `requireAdmin` on `POST /exam-seating/generations` (Phases 4–5). Do not change. |
| View generation status     | ✓        | ✓        | LOCKED — existing `requireAuth` on `GET /exam-seating/generations/:id`. |
| View seating               | ✓        | ✓        | LOCKED — existing `requireAuth` on `GET /exam-seating/generations/:id/seating`. |

## Deferred (no HTTP route exists today)

For every capability below, the **current** behavior is: attempting any HTTP route → `404 NOT_FOUND` (verified in Phase 8b). The permissions below are the **initial intended policy** for when the route is built; they are not current behavior.

| Capability                 | Future intended policy | Notes |
| -------------------------- | ---------------------- | ----- |
| Approve seating plan       | ADMIN-only; STAFF → `403 FORBIDDEN` once a route exists | **DEFERRED — no HTTP route exists (Phase 8b).** Current: no route → `404 NOT_FOUND`. Not current behavior. |
| Publish seating plan       | ADMIN-only; STAFF → `403 FORBIDDEN` once a route exists; concurrent publication conflict must return `409 { error: "ALREADY_PUBLISHED" }` (not the generic 500) | **DEFERRED — no HTTP route exists (Phase 8b).** Current: no route → `404 NOT_FOUND`. See `docs/evidence/phase8b/publication-error-path.log`: today `publishPlan` does not catch P2002 and the API boundary would map it to the Phase 7b generic `500`; that path is unreachable over HTTP until a route is added. When the route is added it must map P2002 → `409 ALREADY_PUBLISHED`. |
| Download Proforma 1        | STAFF inherits the existing view-seating permission unless a product decision changes it; the route must require auth | **DEFERRED — no HTTP route exists (Phase 7a).** Current: no route → `404 NOT_FOUND`. Proforma 1 is produced only in tests today. |

## Decisions recorded (Phase 9)

1. **Upload permission** — decided ADMIN-only for the initial slice (ingestion mutates `ExamCandidate`); STAFF gets `403 FORBIDDEN`. IMPLEMENTED.
2. **Approve / Publish permissions** — not built in the upload slice; recorded as DEFERRED intent (ADMIN-only when introduced).

## Constraints carried forward

- The upload slice adds routes for upload, ingestion status, and validated-candidate view. It does NOT add generation/approve/publish/proforma routes.
- All read routes expose only master-sourced snapshots and never invent a second student-data representation (Phase 9 §8).
- Existing regression surface (Phases 5–8b) must stay green; a new product test passing is not sufficient regression evidence (Phase 9 §11).