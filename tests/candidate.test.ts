import { describe, it, expect } from "vitest";
import { prisma } from "./setup";
import { expectRejected, expectUniqueViolation } from "./helpers";
import {
  createTestCandidate,
  createTestExam,
  createTestStudent,
  createValidatedCandidate,
  seededClass,
} from "./fixtures";
import { createCandidate, transitionValidationStatus } from "../src/services/candidate.service";
import { buildSolverCandidateList, buildSolverInput } from "../src/services/solverInput.service";

describe("ExamCandidate", () => {
  it("references an existing student and exam through real foreign keys", async () => {
    const cls = await seededClass();
    const student = await createTestStudent(cls.id, "A");
    const exam = await createTestExam();
    const candidate = await createTestCandidate(exam.id, student.id);

    const fetched = await prisma.examCandidate.findUnique({
      where: { id: candidate.id },
      include: { student: true, exam: true },
    });
    expect(fetched?.student.id).toBe(student.id);
    expect(fetched?.exam.id).toBe(exam.id);
  });

  it("populates snapshot fields from the student master at candidate creation", async () => {
    const cls = await seededClass("CSE-A");
    const student = await prisma.student.create({
      data: {
        name: "ANANTHA PRIYA S",
        rollNumber: "CSE999",
        registerNumber: "953022104003",
        gender: "FEMALE",
        classId: cls.id,
        status: "ACTIVE",
      },
    });
    const exam = await createTestExam();
    const candidate = await createTestCandidate(exam.id, student.id);

    expect(candidate.studentNameSnapshot).toBe("ANANTHA PRIYA S");
    expect(candidate.departmentSnapshot).toBe("CSE");
    expect(candidate.classSnapshot).toBe("CSE-A");
    expect(candidate.genderSnapshot).toBe("FEMALE");
    expect(candidate.registerNumberSnapshot).toBe("953022104003");
  });

  it("can override the register number snapshot independently of the master record", async () => {
    const cls = await seededClass();
    const student = await createTestStudent(cls.id, "B");
    const exam = await createTestExam();
    const candidate = await createTestCandidate(exam.id, student.id, "PDF-REG-0001");
    expect(candidate.registerNumberSnapshot).toBe("PDF-REG-0001");
    expect(student.registerNumber).not.toBe("PDF-REG-0001");
  });

  it("rejects a duplicate register number within the same exam", async () => {
    const cls = await seededClass();
    const s1 = await createTestStudent(cls.id, "C");
    const s2 = await createTestStudent(cls.id, "D");
    const exam = await createTestExam();
    await createTestCandidate(exam.id, s1.id, "DUP-REG-001");
    await expectUniqueViolation(
      createTestCandidate(exam.id, s2.id, "DUP-REG-001"),
    );
  });

  it("rejects the same student twice within the same exam even with a different register number", async () => {
    const cls = await seededClass();
    const student = await createTestStudent(cls.id, "E");
    const exam = await createTestExam();
    await createTestCandidate(exam.id, student.id, "REG-A-001");
    await expectUniqueViolation(
      createTestCandidate(exam.id, student.id, "REG-A-002"),
    );
  });

  it("allows the same student to participate in different exams", async () => {
    const cls = await seededClass();
    const student = await createTestStudent(cls.id, "F");
    const exam1 = await createTestExam();
    const exam2 = await createTestExam();
    await createTestCandidate(exam1.id, student.id);
    await createTestCandidate(exam2.id, student.id);

    const count = await prisma.examCandidate.count({ where: { studentId: student.id } });
    expect(count).toBe(2);
  });

  it("allows subjects within the same exam to differ per candidate", async () => {
    const cls = await seededClass();
    const s1 = await createTestStudent(cls.id, "G");
    const s2 = await createTestStudent(cls.id, "H");
    const exam = await createTestExam();
    await createCandidate(
      { examId: exam.id, studentId: s1.id, subjectCode: "CS8501", subjectName: "Theory of Computation" },
      "test-actor",
    );
    await createCandidate(
      { examId: exam.id, studentId: s2.id, subjectCode: "CS8602", subjectName: "Compiler Design" },
      "test-actor",
    );
    const codes = (
      await prisma.examCandidate.findMany({ where: { examId: exam.id } })
    )
      .map((c) => c.subjectCode)
      .sort();
    expect(codes).toEqual(["CS8501", "CS8602"]);
  });

  describe("solver gate", () => {
    it("only VALIDATED candidates enter the solver input", async () => {
      const cls = await seededClass();
      const sU = await createTestStudent(cls.id, "U");
      const sM = await createTestStudent(cls.id, "M");
      const sV = await createTestStudent(cls.id, "V");
      const sR = await createTestStudent(cls.id, "R");
      const exam = await createTestExam();

      const unverified = await createTestCandidate(exam.id, sU.id, "GATE-UNVERIFIED");
      const matched = await createTestCandidate(exam.id, sM.id, "GATE-MATCHED");
      await transitionValidationStatus(matched.id, "MATCHED", "test-actor");
      const validated = await createValidatedCandidate(exam.id, sV.id, "GATE-VALIDATED");
      const rejected = await createTestCandidate(exam.id, sR.id, "GATE-REJECTED");
      await transitionValidationStatus(rejected.id, "REJECTED", "test-actor");

      const list = await buildSolverCandidateList(exam.id);
      const ids = list.map((c) => c.id);
      expect(ids).toContain(validated.id);
      expect(ids).not.toContain(unverified.id);
      expect(ids).not.toContain(matched.id);
      expect(ids).not.toContain(rejected.id);

      const input = await buildSolverInput(exam.id);
      expect(input.candidateCount).toBe(1);
      expect(input.candidates.map((c) => c.id)).toEqual([validated.id]);
    });

    it("rejects invalid validation status transitions", async () => {
      const cls = await seededClass();
      const student = await createTestStudent(cls.id, "X");
      const exam = await createTestExam();
      const candidate = await createTestCandidate(exam.id, student.id);
      await expectRejected(
        transitionValidationStatus(candidate.id, "VALIDATED", "test-actor"),
      );
    });
  });
});