# Phase 11 — Approve / Publish HTTP Surface (COMPLETED)

Date: 2026-08-17
Classification: **COMPLETED** — inventory-first; the missing HTTP surface was
built on top of the existing service state machine and DB-enforced
publication gate.

## 1. Inventory (before any code)

Verified against the actual repository, not prior-phase descriptions:

- `POST .../publish` HTTP route: **did not exist**. `publishPlan(id, publishedBy?)`
  existed in `src/services/seatingPlan.service.ts` but was only exercised by tests.
- `POST .../approve` HTTP route: **did not exist**. `approvePlan(id, approvedBy?)`
  existed, tests-only.
- State machine exists: DRAFT -> [APPROVED, SUPERSEDED], APPROVED -> [PUBLISHED,
  SUPERSEDED], PUBLISHED -> [SUPERSEDED] (`assertPlanTransition`). Publish from
  DRAFT was already rejected (approve gates publish).
- `SeatingPlanStatus` enum (`prisma/schema.prisma`): DRAFT, APPROVED, PUBLISHED,
  SUPERSEDED — all states the spec assumed were present.
- `ALREADY_PUBLISHED` / `ALREADY_APPROVED`: **did not exist** anywhere; the
  already-advanced case previously surfaced as `INVALID_PLAN_STATUS_TRANSITION`.
- Audit pattern: `logAudit` is called inside `approvePlan`/`publishPlan`; the
  route only passes the actor id.
- Publication race: DB-enforced via partial unique index
  `seating_plans_one_published_per_exam` (+ `@@unique([examId, version])`),
  verified by `tests/publication-race.test.ts` to be database indexes, not
  app-level checks. The new routes call the existing guarded service path, so
  the DB gate is preserved — no HTTP-level TOCTOU check was added.

## 2. Decisions (explicit)

Permission matrix (settled during Phase 11):

| Action | ADMIN | STAFF |
|---|---|---|
| Read DRAFT plan | allowed | allowed (Phase 10, carried forward) |
| Read PUBLISHED plan | allowed | allowed |
| Approve | allowed | denied (403) |
| Publish | allowed | denied (403) |

Approve gates publish (two-step model confirmed): a DRAFT plan cannot be
published directly; the route returns `409 INVALID_PLAN_STATUS_TRANSITION` and
the plan must be approved first.

## 3. Backend contract added

- `POST /exam-seating/plans/:seatingPlanId/approve` (ADMIN)
  - 200 `{ plan }` (status APPROVED, approvedBy/At recorded)
  - 401 UNAUTHORIZED, 403 FORBIDDEN
  - 404 PLAN_NOT_FOUND (intentional, no internals)
  - 409 ALREADY_APPROVED when already approved
  - audit row PLAN_APPROVED / SeatingPlan
- `POST /exam-seating/plans/:seatingPlanId/publish` (ADMIN)
  - 200 `{ plan }` (status PUBLISHED, publishedBy/At recorded)
  - 401 UNAUTHORIZED, 403 FORBIDDEN
  - 404 PLAN_NOT_FOUND (intentional, no internals)
  - 409 ALREADY_PUBLISHED when already published
  - 409 INVALID_PLAN_STATUS_TRANSITION when publishing a DRAFT plan
  - supersedes any other PUBLISHED plan for the same exam (existing service
    behavior, exercised through the route)
  - audit row PLAN_PUBLISHED / SeatingPlan
- Service pre-checks `ALREADY_APPROVED` / `ALREADY_PUBLISHED` added ahead of the
  existing transition assertion; the DB race gate is untouched.

## 4. Backend verification (saved logs in `docs/evidence/phase10/`)

- New suite `tests/phase11-publish-approve.test.ts`: 12/12 (401 x2, 403 x2,
  DRAFT-publish 409, approve 200 + audit, ALREADY_APPROVED 409, approve 404,
  publish 200 + audit, ALREADY_PUBLISHED 409, publish 404, supersede-to-one).
- Regression 8 files / 53 passed incl. `publication-race.test.ts` (4/4) —
  the race guarantee still holds with the new route wired in:
  `phase11-backend-regression.log`.
- `publication-race.test.ts` + `seating-plan.test.ts` + `snapshot.test.ts`:
  16/16 earlier focused run.
- Root `tsc --noEmit`: clean (exit 0).
- Frozen solver diff `git diff --exit-code HEAD -- solver-service/app/`: exit 0
  (`phase11-frozen-file-diff.log`).

## 5. Frontend

- `frontend/src/lib/api.ts`: `approveSeatingPlan`, `publishSeatingPlan` (POST to
  the plan-scoped routes, unwrap `{ plan }`).
- `frontend/src/components/SeatingPage.tsx`: ADMIN-only actions gated by
  `user.role === "ADMIN"` and current status — "Approve plan" on DRAFT,
  "Publish plan" on APPROVED; in-flight disablement; 409s surfaced as
  informative messages ("already been published"/"already been approved")
  without navigating away; the status shown is the real response-backed plan
  (no fabricated success state). STAFF sees neither button.
- Frontend verification (saved logs): `phase11-frontend-test.log` 8 files /
  87 passed (api client 20, SeatingPage 11, others unchanged); typecheck clean;
  `vite build` OK (48 modules, 199.96 kB JS pre-gzip).

## 6. Staging / commit state

Two commits, kept separate:
1. Backend: `src/services/seatingPlan.service.ts`, `src/phase4/api.ts`,
   `tests/phase11-publish-approve.test.ts` + this closeout.
2. Frontend: `frontend/src/lib/api.ts`, `frontend/src/lib/api.test.ts`,
   `frontend/src/components/SeatingPage.tsx`,
   `frontend/src/components/SeatingPage.test.tsx`.

Each staged via explicit paths and gated with `git diff --cached --name-only`
before commit. No unrelated artifacts staged; no frozen solver changes.

## 7. Remaining roadmap item

The original Phase 10 roadmap's last item (Approve/Publish) is closed. The full
end-to-end acceptance run (Login -> Exam -> Upload -> Processing -> Review ->
Generate -> Status -> View Seating -> Approve/Publish) can now be executed as a
single continuous manual run.