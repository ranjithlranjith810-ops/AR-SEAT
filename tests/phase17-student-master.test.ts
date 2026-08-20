/**
 * Phase 17 — Student Master Management product surface.
 *
 * Exposes the Student/Department/Class master data through real HTTP routes:
 *   GET/POST  /exam-seating/students            (requireAuth — STAFF + ADMIN)
 *   GET/PATCH /exam-seating/students/:id        (requireAuth)
 *   PATCH     /exam-seating/students/:id/status (requireAuth)
 *   GET  /exam-seating/departments              (requireAuth)
 *   POST /exam-seating/departments              (requireAdmin)
 *   PATCH /exam-seating/departments/:id         (requireAdmin)
 *   GET  /exam-seating/classes                  (requireAuth)
 *   POST /exam-seating/classes                  (requireAdmin)
 *   PATCH /exam-seating/classes/:id             (requireAdmin)
 *
 * Every write path records an audit row (STUDENT_CREATED/UPDATED/STATUS_CHANGED,
 * DEPARTMENT_CREATED/UPDATED, CLASS_CREATED/UPDATED). Reads never write. The
 * final test proves a student created through the HTTP API is immediately
 * matchable by real PDF ingestion.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { prisma } from "./setup";
import { createPhase4Server } from "../src/phase4/api";
import { createUser } from "../src/phase4/auth/users";
import { createSession } from "../src/phase4/auth/session";
import { ingestExamDocument } from "../src/services/exam-document/ingest";
import { MemoryDocumentStore } from "../src/services/exam-document/upload";
import { createExam } from "../src/services/exam.service";
import { annaFixtureLines, buildPdf } from "./fixture-pdf";
import type { GenerationResult, SolverDispatch } from "../src/phase4/types";
import type { Server } from "node:http";

const ADMIN_USERNAME = "phase17-admin";
const ADMIN_PASSWORD = "phase17-admin-password-1";
const STAFF_USERNAME = "phase17-staff";
const STAFF_PASSWORD = "phase17-staff-password-1";

const NONCE = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const REGISTER_PREFIX = `P17-${NONCE}`;

let adminId: string;
let adminToken: string;
let staffToken: string;
let server: Server;
let baseUrl: string;

const dispatch = (async () => {
  throw new Error("solver dispatch must never run behind phase17 tests");
}) as unknown as SolverDispatch;

async function request(
  path: string,
  token: string | null,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: init.method ?? "GET",
    headers: {
      ...(token ? { Cookie: `ar_seat_session=${token}` } : {}),
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

async function jsonBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function createdMarkerIds(): Promise<{ students: string[]; departments: string[]; classes: string[] }> {
  const students = await prisma.student.findMany({
    where: { registerNumber: { startsWith: REGISTER_PREFIX } },
    select: { id: true },
  });
  const departments = await prisma.department.findMany({
    where: { code: { startsWith: `P17-` } },
    select: { id: true },
  });
  const classes = await prisma.class.findMany({
    where: { name: { startsWith: `P17-` } },
    select: { id: true },
  });
  return {
    students: students.map((s) => s.id),
    departments: departments.map((d) => d.id),
    classes: classes.map((c) => c.id),
  };
}

describe("phase17 student master product surface", () => {
  beforeAll(async () => {
    const admin = await createUser({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD, role: "ADMIN" });
    adminId = admin.id;
    adminToken = (await createSession(adminId)).token;

    const staff = await createUser({ username: STAFF_USERNAME, password: STAFF_PASSWORD, role: "STAFF" });
    staffToken = (await createSession(staff.id)).token;

    const registry = new Map<string, GenerationResult>();
    server = createPhase4Server({ registry, dispatch });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    const ids = await createdMarkerIds();
    // Students with examination history are guarded by the RDBMS trigger and
    // are cleared by the next setup() TRUNCATE; delete only history-free rows.
    if (ids.students.length > 0) {
      const candidates = await prisma.examCandidate.findMany({
        where: { studentId: { in: ids.students } },
        select: { studentId: true },
      });
      const historyIds = new Set(candidates.map((c) => c.studentId));
      const deletable = ids.students.filter((id) => !historyIds.has(id));
      if (deletable.length > 0) {
        await prisma.student.deleteMany({ where: { id: { in: deletable } } });
      }
    }
    if (ids.classes.length > 0) {
      await prisma.class.deleteMany({ where: { id: { in: ids.classes } } });
    }
    if (ids.departments.length > 0) {
      await prisma.department.deleteMany({ where: { id: { in: ids.departments } } });
    }
    await prisma.$disconnect();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("unauthenticated reads and writes return 401 UNAUTHORIZED", async () => {
    for (const [path, method] of [
      ["/exam-seating/students", "GET"],
      ["/exam-seating/departments", "GET"],
      ["/exam-seating/classes", "GET"],
      ["/exam-seating/students", "POST"],
      ["/exam-seating/departments", "POST"],
      ["/exam-seating/classes", "POST"],
    ] as const) {
      const res = await request(path, null, { method });
      expect(res.status, `${method} ${path}`).toBe(401);
      expect((await jsonBody<{ error: string }>(res)).error).toBe("UNAUTHORIZED");
    }
  });

  it("STAFF can read students/departments/classes but cannot create departments or classes", async () => {
    const reads: Array<[string, string]> = [
      ["/exam-seating/students", "GET"],
      ["/exam-seating/departments", "GET"],
      ["/exam-seating/classes", "GET"],
    ];
    for (const [path, method] of reads) {
      const res = await request(path, staffToken, { method });
      expect(res.status, `${method} ${path}`).toBe(200);
    }

    const forbidden: Array<[string, string]> = [
      ["/exam-seating/departments", "POST"],
      ["/exam-seating/classes", "POST"],
    ];
    for (const [path, method] of forbidden) {
      const res = await request(path, staffToken, {
        method,
        body: { code: `P17-X-${NONCE}`, name: "Should not persist" },
      });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect((await jsonBody<{ error: string }>(res)).error).toBe("FORBIDDEN");
    }
  });

  it("ADMIN creates a department, then lists and updates it with audit rows", async () => {
    const deptCode = `P17-D-${NONCE}`;
    const created = await request("/exam-seating/departments", adminToken, {
      method: "POST",
      body: { code: deptCode, name: "Phase 17 Test Department" },
    });
    expect(created.status).toBe(200);
    const createdBody = await jsonBody<{
      department: { id: string; code: string; name: string };
    }>(created);
    expect(createdBody.department.code).toBe(deptCode);
    const deptId = createdBody.department.id;

    const list = await request("/exam-seating/departments", staffToken);
    expect(list.status).toBe(200);
    const listBody = await jsonBody<{ departments: Array<{ id: string; code: string }> }>(list);
    expect(listBody.departments.some((d) => d.id === deptId)).toBe(true);

    const updated = await request(`/exam-seating/departments/${deptId}`, adminToken, {
      method: "PATCH",
      body: { name: "Phase 17 Test Department (updated)" },
    });
    expect(updated.status).toBe(200);
    const updatedBody = await jsonBody<{ department: { id: string; name: string } }>(updated);
    expect(updatedBody.department.name).toBe("Phase 17 Test Department (updated)");

    const audits = await prisma.auditLog.findMany({
      where: { entityType: "Department", entityId: deptId, actorId: adminId },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((a) => a.action).sort()).toEqual(["DEPARTMENT_CREATED", "DEPARTMENT_UPDATED"]);

    // Cleanup now (marker scan only matches code prefix at afterAll otherwise).
    await prisma.department.deleteMany({ where: { id: deptId } });
  });

  it("rejects duplicate department code and missing fields with 409/400", async () => {
    const deptCode = `P17-DUP-${NONCE}`;
    const created = await request("/exam-seating/departments", adminToken, {
      method: "POST",
      body: { code: deptCode, name: "Duplicate source" },
    });
    expect(created.status).toBe(200);
    const deptId = (await jsonBody<{ department: { id: string } }>(created)).department.id;

    const dup = await request("/exam-seating/departments", adminToken, {
      method: "POST",
      body: { code: deptCode, name: "Duplicate attempt" },
    });
    expect(dup.status).toBe(409);
    expect((await jsonBody<{ error: string }>(dup)).error).toBe("DEPARTMENT_ALREADY_EXISTS");

    const bad = await request("/exam-seating/departments", adminToken, {
      method: "POST",
      body: { code: "", name: "" },
    });
    expect(bad.status).toBe(400);
    expect((await jsonBody<{ error: string }>(bad)).error).toBe("INVALID_INPUT");

    const missing = await request(`/exam-seating/departments/${deptId}`, adminToken, {
      method: "PATCH",
      body: {},
    });
    expect(missing.status).toBe(400);
    expect((await jsonBody<{ error: string }>(missing)).error).toBe("INVALID_INPUT");

    await prisma.department.deleteMany({ where: { id: deptId } });
  });

  it("returns 404 for an unknown department", async () => {
    const res = await request(
      "/exam-seating/departments/00000000-0000-4000-8000-000000000000",
      adminToken,
      { method: "PATCH", body: { name: "Nope" } },
    );
    expect(res.status).toBe(404);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("DEPARTMENT_NOT_FOUND");
  });

  it("ADMIN creates a class, lists it with department context, and updates it with audit rows", async () => {
    const dept = await prisma.department.findFirstOrThrow({ where: { code: "CSE" } });
    const className = `P17-C-${NONCE}`;
    const created = await request("/exam-seating/classes", adminToken, {
      method: "POST",
      body: {
        departmentId: dept.id,
        name: className,
        year: 3,
        section: "X",
        academicYear: "2026-2027",
      },
    });
    expect(created.status).toBe(200);
    const createdBody = await jsonBody<{ class: { id: string; name: string } }>(created);
    expect(createdBody.class.name).toBe(className);
    const classId = createdBody.class.id;

    const list = await request("/exam-seating/classes", staffToken);
    expect(list.status).toBe(200);
    const listBody = await jsonBody<{
      classes: Array<{ id: string; name: string; department: { code: string } }>;
    }>(list);
    const listed = listBody.classes.find((c) => c.id === classId);
    expect(listed).toBeDefined();
    expect(listed!.department.code).toBe("CSE");

    const filtered = await request(`/exam-seating/classes?departmentId=${dept.id}`, staffToken);
    const filteredBody = await jsonBody<{ classes: Array<{ id: string }> }>(filtered);
    expect(filteredBody.classes.some((c) => c.id === classId)).toBe(true);

    const updated = await request(`/exam-seating/classes/${classId}`, adminToken, {
      method: "PATCH",
      body: { section: "Y" },
    });
    expect(updated.status).toBe(200);
    const updatedBody = await jsonBody<{ class: { id: string; section: string } }>(updated);
    expect(updatedBody.class.section).toBe("Y");

    const audits = await prisma.auditLog.findMany({
      where: { entityType: "Class", entityId: classId, actorId: adminId },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((a) => a.action).sort()).toEqual(["CLASS_CREATED", "CLASS_UPDATED"]);

    await prisma.class.deleteMany({ where: { id: classId } });
  });

  it("rejects duplicate class and missing class department with 409/400/404", async () => {
    const dept = await prisma.department.findFirstOrThrow({ where: { code: "CSE" } });
    const className = `P17-CDUPE-${NONCE}`;
    const first = await request("/exam-seating/classes", adminToken, {
      method: "POST",
      body: { departmentId: dept.id, name: className, year: 1, section: "A", academicYear: "2027-2028" },
    });
    expect(first.status).toBe(200);
    const classId = (await jsonBody<{ class: { id: string } }>(first)).class.id;

    const dup = await request("/exam-seating/classes", adminToken, {
      method: "POST",
      body: { departmentId: dept.id, name: className, year: 1, section: "B", academicYear: "2027-2028" },
    });
    expect(dup.status).toBe(409);
    expect((await jsonBody<{ error: string }>(dup)).error).toBe("CLASS_ALREADY_EXISTS");

    const noDept = await request("/exam-seating/classes", adminToken, {
      method: "POST",
      body: {
        departmentId: "00000000-0000-4000-8000-000000000000",
        name: `P17-ORPHAN-${NONCE}`,
        year: 1,
        section: "A",
        academicYear: "2027-2028",
      },
    });
    expect(noDept.status).toBe(404);
    expect((await jsonBody<{ error: string }>(noDept)).error).toBe("DEPARTMENT_NOT_FOUND");

    const bad = await request("/exam-seating/classes", adminToken, {
      method: "POST",
      body: { departmentId: dept.id, name: "", year: 1, section: "", academicYear: "" },
    });
    expect(bad.status).toBe(400);

    await prisma.class.deleteMany({ where: { id: classId } });
  });

  it("STAFF creates, lists, gets, updates, and deactivates a student through the API", async () => {
    const cls = await prisma.class.findFirstOrThrow({ where: { name: "CSE-A" } });
    const registerNumber = `${REGISTER_PREFIX}-STU-001`;

    const created = await request("/exam-seating/students", staffToken, {
      method: "POST",
      body: {
        name: "PHASE17 STUDENT",
        rollNumber: "P17-R-001",
        registerNumber,
        gender: "FEMALE",
        classId: cls.id,
        status: "ACTIVE",
      },
    });
    expect(created.status).toBe(200);
    const createdBody = await jsonBody<{
      student: {
        id: string;
        registerNumber: string;
        gender: string;
        status: string;
        class: { department: { code: string }; name: string };
      };
    }>(created);
    expect(createdBody.student.registerNumber).toBe(registerNumber);
    expect(createdBody.student.gender).toBe("FEMALE");
    expect(createdBody.student.status).toBe("ACTIVE");
    expect(createdBody.student.class.department.code).toBe("CSE");
    const studentId = createdBody.student.id;

    const list = await request(`/exam-seating/students?search=phase17`, staffToken);
    expect(list.status).toBe(200);
    const listBody = await jsonBody<{
      students: Array<{ id: string; registerNumber: string }>;
      total: number;
    }>(list);
    expect(listBody.total).toBeGreaterThanOrEqual(1);
    expect(listBody.students.some((s) => s.id === studentId)).toBe(true);

    const filtered = await request(
      `/exam-seating/students?departmentId=${cls.departmentId}&classId=${cls.id}&status=ACTIVE&limit=1&offset=0`,
      staffToken,
    );
    expect(filtered.status).toBe(200);
    const filteredBody = await jsonBody<{
      students: Array<{ id: string }>;
      limit: number;
      offset: number;
      total: number;
    }>(filtered);
    expect(filteredBody.limit).toBe(1);
    expect(filteredBody.offset).toBe(0);
    expect(filteredBody.students.length).toBeLessThanOrEqual(1);

    const got = await request(`/exam-seating/students/${studentId}`, staffToken);
    expect(got.status).toBe(200);
    const gotBody = await jsonBody<{ student: { id: string; registerNumber: string } }>(got);
    expect(gotBody.student.id).toBe(studentId);

    const updated = await request(`/exam-seating/students/${studentId}`, staffToken, {
      method: "PATCH",
      body: { name: "PHASE17 STUDENT RENAMED" },
    });
    expect(updated.status).toBe(200);
    const updatedBody = await jsonBody<{ student: { id: string; name: string } }>(updated);
    expect(updatedBody.student.name).toBe("PHASE17 STUDENT RENAMED");

    const deactivated = await request(`/exam-seating/students/${studentId}/status`, staffToken, {
      method: "PATCH",
      body: { status: "INACTIVE" },
    });
    expect(deactivated.status).toBe(200);
    const deactivatedBody = await jsonBody<{ student: { id: string; status: string } }>(deactivated);
    expect(deactivatedBody.student.status).toBe("INACTIVE");

    const actionAudits = await prisma.auditLog.findMany({
      where: { entityType: "Student", entityId: studentId },
      select: { action: true },
    });
    expect(actionAudits.map((a) => a.action).sort()).toEqual([
      "STUDENT_CREATED",
      "STUDENT_STATUS_CHANGED",
      "STUDENT_UPDATED",
    ]);

    await prisma.student.deleteMany({ where: { id: studentId } });
  });

  it("rejects duplicate register number and invalid input on student writes", async () => {
    const cls = await prisma.class.findFirstOrThrow({ where: { name: "CSE-B" } });
    const registerNumber = `${REGISTER_PREFIX}-DUP`;

    const first = await request("/exam-seating/students", staffToken, {
      method: "POST",
      body: {
        name: "FIRST DUP",
        rollNumber: "P17-D1",
        registerNumber,
        gender: "MALE",
        classId: cls.id,
        status: "ACTIVE",
      },
    });
    expect(first.status).toBe(200);
    const studentId = (await jsonBody<{ student: { id: string } }>(first)).student.id;

    const dup = await request("/exam-seating/students", staffToken, {
      method: "POST",
      body: {
        name: "SECOND DUP",
        rollNumber: "P17-D2",
        registerNumber,
        gender: "MALE",
        classId: cls.id,
        status: "ACTIVE",
      },
    });
    expect(dup.status).toBe(409);
    expect((await jsonBody<{ error: string }>(dup)).error).toBe("STUDENT_ALREADY_EXISTS");

    const badGender = await request("/exam-seating/students", staffToken, {
      method: "POST",
      body: {
        name: "BAD GENDER",
        rollNumber: "P17-G",
        registerNumber: `${REGISTER_PREFIX}-G`,
        gender: "ALIEN",
        classId: cls.id,
        status: "ACTIVE",
      },
    });
    expect(badGender.status).toBe(400);
    expect((await jsonBody<{ error: string }>(badGender)).error).toBe("INVALID_INPUT");

    const badStatus = await request(`/exam-seating/students/${studentId}/status`, staffToken, {
      method: "PATCH",
      body: { status: "DELETED" },
    });
    expect(badStatus.status).toBe(400);
    expect((await jsonBody<{ error: string }>(badStatus)).error).toBe("INVALID_INPUT");

    const emptyPatch = await request(`/exam-seating/students/${studentId}`, staffToken, {
      method: "PATCH",
      body: {},
    });
    expect(emptyPatch.status).toBe(400);
    expect((await jsonBody<{ error: string }>(emptyPatch)).error).toBe("INVALID_INPUT");

    await prisma.student.deleteMany({ where: { id: studentId } });
  });

  it("returns 404 for an unknown student and 400 for bad pagination", async () => {
    const got = await request(
      "/exam-seating/students/00000000-0000-4000-8000-000000000000",
      staffToken,
    );
    expect(got.status).toBe(404);
    expect((await jsonBody<{ error: string }>(got)).error).toBe("STUDENT_NOT_FOUND");

    for (const bad of ["limit=0", "limit=201", "offset=-1", "limit=abc"]) {
      const res = await request(`/exam-seating/students?${bad}`, staffToken);
      expect(res.status, `?${bad}`).toBe(400);
      expect((await jsonBody<{ error: string }>(res)).error).toBe("INVALID_PAGINATION");
    }
  });

  it("a student created via the HTTP API is matched by real PDF ingestion", async () => {
    const cls = await prisma.class.findFirstOrThrow({ where: { name: "ECE-A" } });
    const registerNumber = `95${NONCE.replace(/\D/g, "").slice(-8).padStart(8, "0")}`.slice(-12);
    const created = await request("/exam-seating/students", adminToken, {
      method: "POST",
      body: {
        name: "INGEST MATCH TARGET",
        rollNumber: "P17-INGEST-R",
        registerNumber,
        gender: "MALE",
        classId: cls.id,
        status: "ACTIVE",
      },
    });
    expect(created.status).toBe(200);
    const studentId = (await jsonBody<{ student: { id: string } }>(created)).student.id;

    const exam = await createExam({ examDate: new Date("2026-11-15T09:30:00Z"), session: "AN" }, "test-actor");
    const pdf = await buildPdf(
      annaFixtureLines([
        { serial: "001", registerNumber, name: "INGEST MATCH TARGET" },
      ]),
    );
    const report = await ingestExamDocument(
      exam.id,
      "phase17-candidate-list.pdf",
      "application/pdf",
      pdf,
      {
        store: new MemoryDocumentStore(),
        storagePath: `exam-documents/${exam.id}/phase17.pdf`,
        actorId: "test-actor",
      },
    );

    expect(report.duplicate).toBe(false);
    expect(report.counts.extractedRows).toBe(1);
    expect(report.counts.matched).toBe(1);
    expect(report.counts.rejected).toBe(0);

    const candidate = await prisma.examCandidate.findFirstOrThrow({
      where: { examId: exam.id },
    });
    expect(candidate.studentId).toBe(studentId);
    expect(candidate.validationStatus).toBe("MATCHED");

    // Exam candidates are RDBMS hard-delete protected; the setup() TRUNCATE
    // clears this file's rows. Mark the exam cancelled to avoid leaking a
    // DRAFT exam that later tests might trip on.
    await prisma.exam.update({ where: { id: exam.id }, data: { status: "CANCELLED" } });
    await prisma.auditLog.deleteMany({
      where: { entityType: "Exam", entityId: exam.id },
    });
  });
});
