import { prisma } from "../db";

export interface SolverCandidate {
  id: string;
  registerNumberSnapshot: string;
  studentNameSnapshot: string;
  departmentSnapshot: string;
  classSnapshot: string;
  genderSnapshot: "MALE" | "FEMALE" | "OTHER";
  subjectCode: string;
  subjectName: string;
}

export interface SolverHallSeat {
  id: string;
  seatPosition: string;
  row: string;
  column: number;
}

export interface SolverHall {
  id: string;
  hallNumber: string;
  name: string;
  building: string | null;
  rows: number;
  columns: number;
  capacity: number;
  seats: SolverHallSeat[];
}

export interface SolverInput {
  candidates: SolverCandidate[];
  candidateCount: number;
  halls: SolverHall[];
  availableSeatCount: number;
}

export async function buildSolverInput(examId: string): Promise<SolverInput> {
  const candidates = await prisma.examCandidate.findMany({
    where: { examId, validationStatus: "VALIDATED" },
    orderBy: { registerNumberSnapshot: "asc" },
    select: {
      id: true,
      registerNumberSnapshot: true,
      studentNameSnapshot: true,
      departmentSnapshot: true,
      classSnapshot: true,
      genderSnapshot: true,
      subjectCode: true,
      subjectName: true,
    },
  });

  const halls = await prisma.hall.findMany({
    where: { isActive: true },
    select: {
      id: true,
      hallNumber: true,
      name: true,
      building: true,
      rows: true,
      columns: true,
      seats: {
        where: { isActive: true },
        select: { id: true, seatPosition: true, row: true, column: true },
        orderBy: [{ row: "asc" }, { column: "asc" }],
      },
    },
    orderBy: { hallNumber: "asc" },
  });

  const hallRows = halls.map((h) => ({ ...h, capacity: h.seats.length }));
  return {
    candidates,
    halls: hallRows,
    candidateCount: candidates.length,
    availableSeatCount: hallRows.reduce((sum, h) => sum + h.capacity, 0),
  };
}

export async function buildSolverCandidateList(examId: string) {
  const candidates = await prisma.examCandidate.findMany({
    where: { examId, validationStatus: "VALIDATED" },
    orderBy: { registerNumberSnapshot: "asc" },
    select: {
      id: true,
      registerNumberSnapshot: true,
      studentNameSnapshot: true,
      departmentSnapshot: true,
      classSnapshot: true,
      genderSnapshot: true,
      subjectCode: true,
      subjectName: true,
    },
  });
  return candidates;
}