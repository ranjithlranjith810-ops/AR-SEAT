# AR-SEAT Dependency Map

How the pieces actually connect (source-verified at HEAD `d3b6d56`).

## Runtime topology

```
                    ┌─────────────┐   cookie session   ┌──────────────────────┐
   Browser (React)  │  Fastify    │◄──────────────────►│  Prisma → Postgres   │
   frontend/:11     │  src/phase4 │                    │  (Supabase, schema)  │
   pages            │  /api.ts    │                    │  + Supabase Storage  │
                    └──────┬──────┘                    └──────────────────────┘
                           │ X-Internal-Token (env)
                           ▼
              ┌─────────────────────────┐
              │ solver-service (Python) │  frozen CP-SAT (ortools)
              │ /health /solve /solve-domain │
              └─────────────────────────┘
```

- **Backend ↔ DB:** Prisma (`src/db.ts`) with `DATABASE_URL` (app) + `DIRECT_URL`. Migrations only (3). Supabase storage used for live PDFs; in-memory store in tests.
- **Backend ↔ Solver:** HTTP over localhost; `X-Internal-Token` guard; `config.ts` limits `SOLVER_MAX_PARALLEL_DOMAINS` (default 4) and `SOLVER_TIME_LIMIT_SECONDS` (default 60). Solver is a hard dependency for generation (real solve, no fallback/stub).
- **Frontend ↔ Backend:** `frontend/src/lib/api.ts` fetch client, credentials cookie, `react-query` in `lib/queryClient.ts`.

## Service dependency chain (generation path)

```
POST /generations
  → integration (create SolveJob QUEUED, audit SOLVE_STARTED)
  → generation.service.partition (by department, register order)
  → guards (capacity/ratio/integrity checks)
  → bounded dispatch → solver-service /solve-domain (domain payloads)
  → validateMerge (duplicate candidate/seat, capacity)
  → persist.persistValidatedGeneration:
       tx { SUPERSEDE latest plan; create DRAFT v+1; createMany assignments;
            audit PLAN_SUPERSEDED }
       → completeSolve (SUCCEEDED)  [only after commit]
```

Key services feeding it: `solverInput.service.buildSolverInput` (VALIDATED candidates + active halls + genderSnapshot/departmentSnapshot/classSnapshot/subjectCode), `exam.service`, `hall.service` (seatPositionsFor), `candidate.service` (snapshots from Student master).

## PDF ingestion chain

```
POST /documents (ADMIN, %PDF, 20MB)
  → ingest: sha256 fileHash → storage (Supabase/memory) → register UploadedExamDocument
  → extract (ANNA_UNIVERSITY_TEXT_TABLE_CONFIG) → normalize
  → validate (issues: MISSING_REGISTER_NUMBER, MISSING_NAME, INVALID_REGISTER_NUMBER,
              STUDENT_NOT_FOUND, NAME_MISMATCH, STUDENT_INACTIVE)
  → lookupStudents (prisma.student) → upsert ExamCandidate snapshots
  → PARSED / NEEDS_REVIEW / REJECTED (+ audits PDF_UPLOADED / CANDIDATE_MATCHED)
  → resolve endpoint → VALIDATED / REJECTED (transitionValidationStatus, audit CANDIDATE_RESOLVED)
```

## Auth chain

```
POST /auth/login (argon2 verify) → AuthSession row → httpOnly cookie
GET /auth/me → session restore
Route guards: requireAuth (all) / requireAdmin (ADMIN mutations + exams list + audit read)
Frontend: AuthProvider consumes /auth/me; Layout hides admin nav for STAFF (cosmetic; backend enforces)
```

## Notable dependency caveats

- `proforma.ts` (pdf-lib) → **unused by any route** (G-06). 
- `hall.service` / `seatAssignment.service` / many solver-input helpers → only consumed by tests today (G-19).
- No `docker-compose.yml`; dev runtime assembled by uncommitted `scripts/dev-all.mjs` (postgres, backend, solver, frontend). E2E DB is a dedicated disposable Docker postgres on `127.0.0.1:55432`.
- No package-manager lockfile commits visible beyond root/frontend; dependency installation is standard `npm install`.