# Phase 7a — Proforma 1 Download Authorization Verification

Date: 2026-08-15
Classification: **CASE B — VERIFIED WITH NOTED FINDING (no endpoint exists)**

## Objective
Confirm whether the endpoint that serves a generated Proforma 1 PDF requires a
valid authenticated session, and enforce it if it doesn't.

## Result
**There is no Proforma download endpoint.** The premise was tested rather than
assumed, and it does not hold: nothing in the codebase serves a generated
Proforma 1 PDF over HTTP. The task's "if unprotected — fix" branch therefore
does not apply; no code change was made (scope fence respected). The correct
outcome is a recorded finding, not a fabricated guard on a nonexistent route.

## Findings

### 1. Route identification
- The only HTTP server is `src/phase4/api.ts` (`createPhase4Server`,
  `node:http`, no framework). Route inventory:
  - `POST /auth/login` (public), `POST /auth/logout` (public)
  - `GET  /auth/me` (`requireAuth`)
  - `POST /exam-seating/generations` (`requireAdmin`)
  - `GET  /exam-seating/generations/:id` (`requireAuth`)
  - `GET  /exam-seating/generations/:id/seating` (`requireAuth`)
- **No proforma/PDF/download route exists** in `api.ts` or anywhere else
  (grep of `src/`, `tests/`, `scripts/` for `/proforma`, `/pdf`, `/download`,
  `Content-Disposition`, `attachment`, `inline`: no serving path).
- `generateProforma1` (`src/phase4/proforma.ts:60`) is a pure in-memory
  generator (pdf-lib) invoked only by tests (phase4-e2e, phase4-ingestion-e2e,
  phase4-orchestration). The generation pipeline
  (`src/phase4/generation.service.ts`) never calls it; generation persists
  SolveJob + SeatingPlan/SeatAssignment rows only.
- Corroboration: `docs/evidence/phase5-auth/phase5-auth-closeout.md:167`
  lists "Proforma download" among routes reserved for a future auth gate —
  it was explicitly never implemented.

### 2. requireAuth check
N/A — no route exists to guard. The existing generation routes all enforce
auth and were confirmed empirically (below).

### 3. Empirical test (recorded honestly)
`proforma-route-identification.log` (no DB required: `resolveSession(null)`
short-circuits before any query):
- Baseline gated routes, no cookie → **401 UNAUTHORIZED** (`/auth/me`,
  `/exam-seating/generations/gen:abc`, `.../seating`).
- All plausible Proforma URLs, no cookie → **404 NOT_FOUND** with body
  `{"error":"NOT_FOUND","message":"no route for GET <path>"}`:
  `/exam-seating/generations/gen:abc/proforma`,
  `/exam-seating/generations/gen:abc/proforma.pdf`,
  `/exam-seating/generations/gen:abc/pdf`,
  `/exam-seating/proforma/gen:abc`, `/proforma/gen:abc`,
  `/download/proforma/gen:abc`.
- An unauthenticated request cannot obtain a Proforma PDF because no route can
  return one. There is nothing to 401 against.

### 4. Content-Disposition (informational)
No Content-Disposition is set anywhere for Proforma output — nothing writes a
Proforma PDF to an HTTP response. `attachment` vs `inline` is a product
decision to make only when a download endpoint is built (inline on a
shared/kiosk machine could render candidate data in-browser). Recorded;
no fix required. See `content-disposition-finding.log`.

### 5. Retention (informational, no fix required)
Generated PDFs are never persisted (in-memory only); there is no TTL/cleanup
to assess and no storage-layer retention question. PDFs are regenerable from
the published plan via `buildProformaInputFromPlan`. A retention policy is a
product decision for the future download feature. See `retention-finding.log`.

## Regression
No code changed (zero diff). pytest / npm / typecheck are trivially unaffected;
no run needed. (If a download endpoint is later added, the Phase 5 auth tests
plus a new unauthenticated→401 test must be run.)

## Evidence files (`docs/evidence/phase7a/`)
- `proforma-route-identification.log` — live probe: baseline 401s + proforma
  URLs all 404, no cookie; route inventory.
- `content-disposition-finding.log`
- `retention-finding.log`
- `phase7a-closeout.md` (this file)

## Commit status
**NOT COMMITTED** — closed as a finding with no code change. Evidence logs are
gitignored (`*.log`); this close-out `.md` is left untracked in the working
tree pending instruction.

## Recommendation (non-blocking)
When a Proforma download feature is eventually implemented: mount it as
`GET /exam-seating/generations/:id/proforma`, gate with `requireAuth` (STAFF
downloads match their existing view-only permission for generation status and
seating), serve bytes with `Content-Type: application/pdf` and
`Content-Disposition: attachment`, and add an unauthenticated→401 test in the
Phase 5 auth suite.