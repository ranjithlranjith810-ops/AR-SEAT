# Phase 18 provenance - student.service.ts provenance and coverage
Date: 2026-08-19 19:54:40 +05:30

## 1. Is student.service.ts imported by shipped Phase 17 routes?
YES - src/phase4/api.ts:61 imports from '../services/student.service' (routes handleListStudents/handleGetStudent/handleCreateStudent/handleUpdateStudent/handleChangeStudentStatus all delegate to it).

## 2. Is its behavior directly covered by the Phase 17 backend test suite?
Coverage is via the shipped HTTP surface in tests/phase17-student-master.test.ts (no direct service-level import). The following behaviors are exercised through the routes:
  - createStudent: POST /exam-seating/students (success + duplicate register -> 409 + invalid gender/status -> 400)
  - listStudents: GET /exam-seating/students?search=phase17 (search), departmentId+classId+status+limit+offset (filters/pagination), INVALID_PAGINATION -> 400
  - getStudent: GET /exam-seating/students/:id (200 + unknown -> 404 STUDENT_NOT_FOUND)
  - updateStudent: PATCH /exam-seating/students/:id (200 + empty patch -> 400)
  - changeStudentStatus: PATCH /exam-seating/students/:id/status (200 + bad status -> 400)
  - audit rows: STUDENT_CREATED/STUDENT_UPDATED/STUDENT_STATUS_CHANGED asserted in phase17 tests
  - ingestion integration: a student created via the HTTP API is matched by real PDF ingestion (proves master is authoritative)

## 3. Coverage classification
student.service.ts is load-bearing AND has meaningful coverage through the shipped route surface. 
No direct unit-level test file imports student.service.ts, but every public function and its error paths are covered via the Phase 17 HTTP tests + the Phase 17 ingestion integration test.

VERDICT: NO PHASE 17 TEST-COVERAGE GAP for the shipped surface. (Recorded: coverage is route-mediated, not service-level direct.)
