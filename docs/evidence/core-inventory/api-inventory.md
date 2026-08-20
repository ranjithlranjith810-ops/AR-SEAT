# AR-SEAT API Inventory

Ground truth: `src/phase4/api.ts` (787 lines) — the **only** backend HTTP surface. No other server exposes routes. All routes mount on the Fastify instance built in `src/app.ts` / `src/phase4/integration.ts`.

## Route table

| Method | Path | RBAC | Purpose | Backing service |
|---|---|---|---|---|
| POST | `/auth/login` | public | Authenticate, set session cookie | `auth/` password + session |
| POST | `/auth/logout` | public | Destroy session | `auth/` |
| GET | `/auth/me` | auth | Current user | `auth/` |
| POST | `/exam-seating/generations` | **ADMIN** | Run generation for an exam | `generation.service` + `integration` |
| GET | `/exam-seating/exams` | **ADMIN** | List exams | `exam.service.listExams` |
| GET | `/exam-seating/audit-logs` | **ADMIN** | Paged audit log (Phase 16) | `audit.service` + whitelist serializer |
| GET | `/exam-seating/generations/:id` | auth | Generation detail | solveJob/plan |
| GET | `/exam-seating/generations/:id/seating` | auth | Seating for generation | plan read |
| GET | `/exam-seating/plans/:seatingPlanId` | auth | Plan detail w/ assignments | `persist.getSeatingPlanById` |
| POST | `/exam-seating/plans/:id/approve` | **ADMIN** | Approve plan | plan service |
| POST | `/exam-seating/plans/:id/publish` | **ADMIN** | Publish plan | plan service |
| POST | `/exam-seating/documents?examId=` | **ADMIN** | Upload PDF (20 MB, %PDF magic) | `exam-document/ingest.ts` |
| GET | `/exam-seating/documents/:id` | auth | Document + parse status | ingest |
| GET | `/exam-seating/documents/:id/candidates` | auth | Candidate list for doc | candidate service |
| POST | `/exam-seating/documents/:docId/candidates/:candidateId/resolve` | **ADMIN** | Resolve validation status | `candidate.service.transitionValidationStatus` |

15 routes total. Every route is real — no stub bodies, no hardcoded fixtures, no TODOs.

## Explicitly NOT in the API (verified)

- **Student CRUD** (no student routes at all)
- **Department CRUD** · **Class CRUD** · **Hall CRUD**
- **Exam creation / edit / transition** (only read-list)
- **Seating PDF download / generation trigger** (no `/proforma`, no `/seating.pdf`)
- **Gender / seating-rule configuration**
- **Bulk import** of students
- **Solver status / health passthrough** (no external health surface)

## Conventions observed

- RBAC enforced in route layer via `requireAuth` / `requireAdmin` (backend truth; frontend hiding is cosmetic only).
- Error shape via `SeatingError` codes → HTTP mapping; consistent JSON envelopes.
- Request size limit 20 MB on PDF upload; `%PDF` magic check rejects non-PDF.
- Audit actions written inside service transactions (see `database-inventory.md`).
- Query params validated; malformed IDs → 400; not-found → 404; forbidden → 403.