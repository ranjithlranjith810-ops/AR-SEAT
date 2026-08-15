# Phase 6 TB3 — Pre-Commit Review (evidence/test cleanup pass)

Date: 2026-08-15
HEAD: 38e917d94d22c2880ee9b4142026633112f2066c (all Phase 6 changes UNCOMMITTED)

## Checklist

Secret audit: PASS
- All Phase 6 `.log` files were scanned for token literals and credential
  material (token values, `SOLVER_INTERNAL_TOKEN=`, `X-Internal-Token:`,
  Authorization, cookies, session tokens, passwords, connection strings, API
  keys). Only SYNTHETIC test/dev token literals were found; no real
  credentials of any kind.
- Redaction performed: token literals replaced with `<DEFAULT_TOKEN>`,
  `<TEST_TOKEN>`, `<REAL_CONFIGURED_TOKEN>` in the `.log` files and in the
  tracked closeout.md; factual HTTP outcomes preserved unchanged.
- Raw originals retained locally (outside the repo).
- See `secret-audit.log`.

401-before-422 test: PASS
- `test_invalid_token_rejected_before_payload_validation` added to both
  `solver-service/tests/test_api.py` (/solve) and
  `solver-service/tests/test_solve_domain.py` (/solve-domain). Each asserts
  status 401 (NOT 422) for a wrong token + malformed body, asserts the
  authentication error body, and proves the solver handler was NEVER invoked
  via a monkeypatch spy. Dedicated run: 2 passed (see `tb3-auth-order-test.log`).

Docker topology classification: DECLARED_ONLY (NOT EMPIRICALLY VERIFIED)
- Dev topology: EMPIRICALLY VERIFIED (live netstat: `127.0.0.1:8000` loopback).
- Docker topology: DECLARED BY DOCKERFILE (`--host 0.0.0.0`); no deployment
  manifest exists to prove container network membership. Documented as
  provisional in `topology-decision.md` §1. Implementation unchanged.

Frozen solver: UNCHANGED
- `git diff --exit-code` over seatlabel.py, solver.py, graph.py, partition.py,
  guards.py, validation.py → exit 0 (byte-identical). See `frozen-file-diff.log`.

pytest: 98 passed, 1 warning (exit 0)
- See `final-regression.log` §1.

npm: FAILED - TRANSIENT INFRA (Supabase pooler degradation), NOT a code regression
- Full suite attempt 1: 2 failed / 133 passed / 3 skipped. Affected:
  phase4-persistence (connection closed), phase5-auth Test C (30s login
  timeout) — both files pass in ISOLATION (3/3 and 7/7) minutes later.
- Full suite re-run: 5 failed / 107 passed / 26 skipped. All failures are
  DB-latency signatures (transaction expired at 5000 ms after 9997 ms,
  "Server has closed the connection", 30s test timeouts) in UNTOUCHED
  DB-integration files (phase4-reconcile, phase5-auth, solve-job, candidate,
  deletion, phase4-persistence, seating-plan). None are the files/tests added
  or modified by this task.
- The identical code passed 135 passed / 3 skipped twice earlier the same day
  before this review pass. Per STOP conditions, no unrelated code was modified
  to chase a green run; the failure is recorded honestly as infra-transient.
- See `final-regression.log` §4 and §4b.

typecheck: clean (exit 0)
- See `final-regression.log` §2.

orchestration: 26 passed / 26 (exit 0) — unfiltered run of
`tests/phase4-orchestration.test.ts`
- See `final-regression.log` §3.

## Production source changes (this task + the Phase 6 implementation it reviews)

All uncommitted tracked changes vs HEAD:

| File | Class |
|------|-------|
| `solver-service/app/config.py` | Phase 6 implementation (fail-closed verify_token). In-scope. |
| `solver-service/app/main.py` | Phase 6 implementation (shared auth dependency). In-scope. |
| `src/phase4/solverClient.ts` | Phase 6 implementation (no silent token fallback). In-scope. |
| `scripts/benchmark-parallel.ts` | Phase 6 cleanup (real benchmark token). In-scope. |
| `scripts/run-tests.mjs` | Phase 6 cleanup (test env token). In-scope. |
| `scripts/run-one-test.mjs` | Phase 6 cleanup (test env token). In-scope. |
| `solver-service/tests/test_api.py` | Security tests (incl. new auth-order test). In-scope. |
| `solver-service/tests/test_solve_domain.py` | Security tests (incl. new auth-order test). In-scope. |
| `solver-service/tests/test_config.py` (untracked new) | Security tests. In-scope. |
| `tests/phase4-orchestration.test.ts` | Node solverClient security tests. In-scope. |

No out-of-scope source file is modified. Frozen files unchanged. No CP-SAT
changes. No mTLS. Phase 5 user auth untouched. `/health` untouched (no defect).

Untracked (not part of this change): pre-existing phase3/phase4 evidence logs,
`docs/phase3-discovery.md`, `tests/phase4-ingestion-e2e.test.ts` (Phase 4 §24
test, recommended separate follow-up), stray `eating prototype✎`,
`docs/evidence/phase6-tb3/` (this phase's evidence, tracked .md + gitignored
.log).

Commit status: NOT COMMITTED