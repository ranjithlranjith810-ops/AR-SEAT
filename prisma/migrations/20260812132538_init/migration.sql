-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'PASSED_OUT', 'TRANSFERRED');

-- CreateEnum
CREATE TYPE "ExamSession" AS ENUM ('FN', 'AN');

-- CreateEnum
CREATE TYPE "ExamType" AS ENUM ('UNIVERSITY', 'INTERNAL', 'MODEL');

-- CreateEnum
CREATE TYPE "ExamStatus" AS ENUM ('DRAFT', 'READY', 'GENERATING', 'GENERATED', 'APPROVED', 'PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CandidateValidationStatus" AS ENUM ('UNVERIFIED', 'MATCHED', 'VALIDATED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocumentParseStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'PARSED', 'NEEDS_REVIEW', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "SeatingPlanStatus" AS ENUM ('DRAFT', 'APPROVED', 'PUBLISHED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "SolveJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'INFEASIBLE', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SolverStatus" AS ENUM ('OPTIMAL', 'FEASIBLE', 'INFEASIBLE', 'ERROR');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('PDF_UPLOADED', 'CANDIDATE_MATCHED', 'CANDIDATE_RESOLVED', 'EXAM_CREATED', 'SOLVE_REQUESTED', 'SOLVE_STARTED', 'SOLVE_COMPLETED', 'SOLVE_FAILED', 'PLAN_APPROVED', 'PLAN_PUBLISHED', 'PLAN_SUPERSEDED');

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classes" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "section" TEXT NOT NULL,
    "academic_year" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roll_number" TEXT NOT NULL,
    "register_number" TEXT NOT NULL,
    "gender" "Gender" NOT NULL,
    "class_id" TEXT NOT NULL,
    "status" "StudentStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exams" (
    "id" TEXT NOT NULL,
    "exam_date" TIMESTAMP(3) NOT NULL,
    "session" "ExamSession" NOT NULL,
    "exam_type" "ExamType" NOT NULL DEFAULT 'UNIVERSITY',
    "status" "ExamStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_candidates" (
    "id" TEXT NOT NULL,
    "exam_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "source_document_id" TEXT,
    "register_number_snapshot" TEXT NOT NULL,
    "student_name_snapshot" TEXT NOT NULL,
    "department_snapshot" TEXT NOT NULL,
    "gender_snapshot" "Gender" NOT NULL,
    "class_snapshot" TEXT NOT NULL,
    "subject_code" TEXT NOT NULL,
    "subject_name" TEXT NOT NULL,
    "validation_status" "CandidateValidationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploaded_exam_documents" (
    "id" TEXT NOT NULL,
    "exam_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL DEFAULT 0,
    "file_hash" TEXT NOT NULL,
    "parse_status" "DocumentParseStatus" NOT NULL DEFAULT 'UPLOADED',
    "parse_metadata" JSONB,
    "uploaded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uploaded_exam_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "halls" (
    "id" TEXT NOT NULL,
    "hall_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "building" TEXT,
    "rows" INTEGER NOT NULL,
    "columns" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "halls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hall_seats" (
    "id" TEXT NOT NULL,
    "hall_id" TEXT NOT NULL,
    "seat_position" TEXT NOT NULL,
    "row" TEXT NOT NULL,
    "column" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hall_seats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seating_plans" (
    "id" TEXT NOT NULL,
    "exam_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "SeatingPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "supersedes_plan_id" TEXT,
    "created_by" TEXT,
    "approved_by" TEXT,
    "published_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seating_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_assignments" (
    "id" TEXT NOT NULL,
    "seating_plan_id" TEXT NOT NULL,
    "exam_candidate_id" TEXT NOT NULL,
    "hall_id" TEXT NOT NULL,
    "hall_seat_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seat_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solve_jobs" (
    "id" TEXT NOT NULL,
    "exam_id" TEXT NOT NULL,
    "status" "SolveJobStatus" NOT NULL DEFAULT 'QUEUED',
    "solver_status" "SolverStatus",
    "requested_by" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "heartbeat_at" TIMESTAMP(3),
    "candidate_count" INTEGER NOT NULL DEFAULT 0,
    "hall_count" INTEGER NOT NULL DEFAULT 0,
    "assigned_count" INTEGER NOT NULL DEFAULT 0,
    "unassigned_count" INTEGER NOT NULL DEFAULT 0,
    "solver_duration_ms" INTEGER,
    "time_limit_seconds" INTEGER,
    "error_code" TEXT,
    "error_message" TEXT,
    "infeasibility_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solve_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" "AuditAction" NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");

-- CreateIndex
CREATE INDEX "classes_department_id_idx" ON "classes"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "classes_department_id_name_academic_year_key" ON "classes"("department_id", "name", "academic_year");

-- CreateIndex
CREATE UNIQUE INDEX "students_register_number_key" ON "students"("register_number");

-- CreateIndex
CREATE INDEX "students_roll_number_idx" ON "students"("roll_number");

-- CreateIndex
CREATE INDEX "students_class_id_idx" ON "students"("class_id");

-- CreateIndex
CREATE INDEX "students_status_idx" ON "students"("status");

-- CreateIndex
CREATE INDEX "exams_status_idx" ON "exams"("status");

-- CreateIndex
CREATE INDEX "exam_candidates_exam_id_idx" ON "exam_candidates"("exam_id");

-- CreateIndex
CREATE INDEX "exam_candidates_student_id_idx" ON "exam_candidates"("student_id");

-- CreateIndex
CREATE INDEX "exam_candidates_register_number_snapshot_idx" ON "exam_candidates"("register_number_snapshot");

-- CreateIndex
CREATE INDEX "exam_candidates_validation_status_idx" ON "exam_candidates"("validation_status");

-- CreateIndex
CREATE UNIQUE INDEX "exam_candidates_exam_id_register_number_snapshot_key" ON "exam_candidates"("exam_id", "register_number_snapshot");

-- CreateIndex
CREATE UNIQUE INDEX "exam_candidates_exam_id_student_id_key" ON "exam_candidates"("exam_id", "student_id");

-- CreateIndex
CREATE INDEX "uploaded_exam_documents_exam_id_idx" ON "uploaded_exam_documents"("exam_id");

-- CreateIndex
CREATE INDEX "uploaded_exam_documents_parse_status_idx" ON "uploaded_exam_documents"("parse_status");

-- CreateIndex
CREATE UNIQUE INDEX "halls_hall_number_key" ON "halls"("hall_number");

-- CreateIndex
CREATE INDEX "hall_seats_hall_id_idx" ON "hall_seats"("hall_id");

-- CreateIndex
CREATE INDEX "hall_seats_is_active_idx" ON "hall_seats"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "hall_seats_hall_id_seat_position_key" ON "hall_seats"("hall_id", "seat_position");

-- CreateIndex
CREATE INDEX "seating_plans_exam_id_idx" ON "seating_plans"("exam_id");

-- CreateIndex
CREATE INDEX "seating_plans_status_idx" ON "seating_plans"("status");

-- CreateIndex
CREATE UNIQUE INDEX "seating_plans_exam_id_version_key" ON "seating_plans"("exam_id", "version");

-- CreateIndex
CREATE INDEX "seat_assignments_seating_plan_id_idx" ON "seat_assignments"("seating_plan_id");

-- CreateIndex
CREATE INDEX "seat_assignments_exam_candidate_id_idx" ON "seat_assignments"("exam_candidate_id");

-- CreateIndex
CREATE INDEX "seat_assignments_hall_id_idx" ON "seat_assignments"("hall_id");

-- CreateIndex
CREATE UNIQUE INDEX "seat_assignments_seating_plan_id_exam_candidate_id_key" ON "seat_assignments"("seating_plan_id", "exam_candidate_id");

-- CreateIndex
CREATE UNIQUE INDEX "seat_assignments_seating_plan_id_hall_id_hall_seat_id_key" ON "seat_assignments"("seating_plan_id", "hall_id", "hall_seat_id");

-- CreateIndex
CREATE INDEX "solve_jobs_exam_id_idx" ON "solve_jobs"("exam_id");

-- CreateIndex
CREATE INDEX "solve_jobs_status_idx" ON "solve_jobs"("status");

-- CreateIndex
CREATE INDEX "solve_jobs_heartbeat_at_idx" ON "solve_jobs"("heartbeat_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_candidates" ADD CONSTRAINT "exam_candidates_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_candidates" ADD CONSTRAINT "exam_candidates_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_candidates" ADD CONSTRAINT "exam_candidates_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "uploaded_exam_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploaded_exam_documents" ADD CONSTRAINT "uploaded_exam_documents_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hall_seats" ADD CONSTRAINT "hall_seats_hall_id_fkey" FOREIGN KEY ("hall_id") REFERENCES "halls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seating_plans" ADD CONSTRAINT "seating_plans_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seating_plans" ADD CONSTRAINT "seating_plans_supersedes_plan_id_fkey" FOREIGN KEY ("supersedes_plan_id") REFERENCES "seating_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_seating_plan_id_fkey" FOREIGN KEY ("seating_plan_id") REFERENCES "seating_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_exam_candidate_id_fkey" FOREIGN KEY ("exam_candidate_id") REFERENCES "exam_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_hall_id_fkey" FOREIGN KEY ("hall_id") REFERENCES "halls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_hall_seat_id_fkey" FOREIGN KEY ("hall_seat_id") REFERENCES "hall_seats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solve_jobs" ADD CONSTRAINT "solve_jobs_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Manual additions (not expressible in the Prisma schema):
--
--  1. Partial unique indexes:
--     - seating_plans: only one PUBLISHED plan per exam
--     - solve_jobs:    only one active (QUEUED / RUNNING) job per exam
--  2. No-hard-delete policy triggers for operational records
--  3. Student hard-delete guard (allowed only without examination history)
--  4. ExamCandidate snapshot immutability trigger
-- ---------------------------------------------------------------------------

-- 1a. One published seating plan per exam
CREATE UNIQUE INDEX "seating_plans_one_published_per_exam"
    ON "seating_plans"("exam_id")
    WHERE status = 'PUBLISHED';

-- 1b. One active solve job per exam (idempotency)
CREATE UNIQUE INDEX "solve_jobs_one_active_per_exam"
    ON "solve_jobs"("exam_id")
    WHERE status IN ('QUEUED', 'RUNNING');

-- 2. Shared no-hard-delete guard for operational records
CREATE OR REPLACE FUNCTION es_protect_hard_delete() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'hard delete is disabled for table %', TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_es_exams_no_delete
    BEFORE DELETE ON "exams"
    FOR EACH ROW EXECUTE FUNCTION es_protect_hard_delete();

CREATE TRIGGER trg_es_exam_candidates_no_delete
    BEFORE DELETE ON "exam_candidates"
    FOR EACH ROW EXECUTE FUNCTION es_protect_hard_delete();

CREATE TRIGGER trg_es_seating_plans_no_delete
    BEFORE DELETE ON "seating_plans"
    FOR EACH ROW EXECUTE FUNCTION es_protect_hard_delete();

CREATE TRIGGER trg_es_seat_assignments_no_delete
    BEFORE DELETE ON "seat_assignments"
    FOR EACH ROW EXECUTE FUNCTION es_protect_hard_delete();

CREATE TRIGGER trg_es_uploaded_documents_no_delete
    BEFORE DELETE ON "uploaded_exam_documents"
    FOR EACH ROW EXECUTE FUNCTION es_protect_hard_delete();

CREATE TRIGGER trg_es_solve_jobs_no_delete
    BEFORE DELETE ON "solve_jobs"
    FOR EACH ROW EXECUTE FUNCTION es_protect_hard_delete();

-- 3. Student hard-delete guard: preserved once examination history exists
CREATE OR REPLACE FUNCTION es_prevent_student_delete() RETURNS trigger AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM "exam_candidates" ec WHERE ec.student_id = OLD.id) THEN
        RAISE EXCEPTION 'student with examination history cannot be hard-deleted' USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_es_students_no_delete_with_history
    BEFORE DELETE ON "students"
    FOR EACH ROW EXECUTE FUNCTION es_prevent_student_delete();

-- 4. ExamCandidate snapshot immutability: never rewrite history for candidates
--    that participate in a PUBLISHED seating plan.
CREATE OR REPLACE FUNCTION es_prevent_published_snapshot_change() RETURNS trigger AS $$
BEGIN
    IF (
        OLD."register_number_snapshot" IS DISTINCT FROM NEW."register_number_snapshot"
        OR OLD."student_name_snapshot" IS DISTINCT FROM NEW."student_name_snapshot"
        OR OLD."department_snapshot" IS DISTINCT FROM NEW."department_snapshot"
        OR OLD."class_snapshot" IS DISTINCT FROM NEW."class_snapshot"
        OR OLD."gender_snapshot" IS DISTINCT FROM NEW."gender_snapshot"
    ) AND EXISTS (
        SELECT 1 FROM "seat_assignments" sa
        JOIN "seating_plans" sp ON sp.id = sa.seating_plan_id
        WHERE sa.exam_candidate_id = OLD.id AND sp.status = 'PUBLISHED'
    ) THEN
        RAISE EXCEPTION 'snapshot fields are immutable once the candidate is part of a published seating plan' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_es_exam_candidates_snapshot_immutable
    BEFORE UPDATE ON "exam_candidates"
    FOR EACH ROW EXECUTE FUNCTION es_prevent_published_snapshot_change();
