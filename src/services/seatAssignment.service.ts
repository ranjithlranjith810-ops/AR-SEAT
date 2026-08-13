import { prisma } from "../db";
import { SeatingError } from "../errors";

export interface AssignSeatInput {
  seatingPlanId: string;
  examCandidateId: string;
  hallId: string;
  hallSeatId: string;
}

export async function assignCandidateSeat(input: AssignSeatInput) {
  const plan = await prisma.seatingPlan.findUnique({ where: { id: input.seatingPlanId } });
  if (!plan) throw new SeatingError("SeatingPlan not found", "PLAN_NOT_FOUND");

  const candidate = await prisma.examCandidate.findUnique({
    where: { id: input.examCandidateId },
  });
  if (!candidate) throw new SeatingError("ExamCandidate not found", "CANDIDATE_NOT_FOUND");
  if (candidate.examId !== plan.examId) {
    throw new SeatingError(
      "Candidate does not belong to the seating plan's exam",
      "CANDIDATE_EXAM_MISMATCH",
    );
  }

  const seat = await prisma.hallSeat.findUnique({ where: { id: input.hallSeatId } });
  if (!seat) throw new SeatingError("HallSeat not found", "HALL_SEAT_NOT_FOUND");
  if (seat.hallId !== input.hallId) {
    throw new SeatingError(
      "HallSeat does not belong to the given hall",
      "HALL_SEAT_MISMATCH",
    );
  }

  return prisma.seatAssignment.create({
    data: {
      seatingPlanId: input.seatingPlanId,
      examCandidateId: input.examCandidateId,
      hallId: input.hallId,
      hallSeatId: input.hallSeatId,
    },
  });
}

export async function listAssignments(seatingPlanId: string) {
  return prisma.seatAssignment.findMany({
    where: { seatingPlanId },
    include: {
      examCandidate: true,
      hallSeat: true,
    },
    orderBy: { createdAt: "asc" },
  });
}