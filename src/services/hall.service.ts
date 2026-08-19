import { prisma } from "../db";
import { SeatingError } from "../errors";

export interface CreateHallInput {
  hallNumber: string;
  name: string;
  building?: string | null;
  rows: number;
  columns: number;
}

export function seatPositionsFor(rows: number, columns: number): Array<{
  seatPosition: string;
  row: string;
  column: number;
}> {
  const seats: Array<{ seatPosition: string; row: string; column: number }> = [];
  for (let r = 0; r < rows; r++) {
    const letter = String.fromCharCode(65 + r);
    for (let c = 1; c <= columns; c++) {
      seats.push({ seatPosition: `${letter}${c}`, row: letter, column: c });
    }
  }
  return seats;
}

export async function createHall(input: CreateHallInput) {
  return prisma.$transaction(async (tx) => {
    const hall = await tx.hall.create({
      data: {
        hallNumber: input.hallNumber,
        name: input.name,
        building: input.building ?? null,
        rows: input.rows,
        columns: input.columns,
        isActive: true,
      },
    });
    const positions = seatPositionsFor(input.rows, input.columns);
    await tx.hallSeat.createMany({
      data: positions.map((p) => ({ ...p, hallId: hall.id })),
    });
    return hall;
  });
}

export async function getHall(id: string) {
  const hall = await prisma.hall.findUnique({ where: { id } });
  if (!hall) throw new SeatingError("Hall not found", "HALL_NOT_FOUND");
  return hall;
}

export async function listHalls() {
  return prisma.hall.findMany({
    orderBy: { hallNumber: "asc" },
    include: {
      seats: {
        orderBy: [{ row: "asc" }, { column: "asc" }],
        select: { id: true, benchId: true, seatPosition: true, row: true, column: true, isActive: true },
      },
      benches: {
        orderBy: { benchNumber: "asc" },
        include: {
          seats: {
            orderBy: [{ row: "asc" }, { column: "asc" }],
            select: { id: true, benchId: true, seatPosition: true, row: true, column: true, isActive: true },
          },
        },
      },
    },
  });
}

export async function updateHall(
  id: string,
  patch: { name?: string; building?: string | null; isActive?: boolean },
) {
  await getHall(id);
  if (Object.keys(patch).length === 0) {
    throw new SeatingError("at least one field must be provided", "INVALID_INPUT");
  }
  return prisma.hall.update({
    where: { id },
    data: { name: patch.name, building: patch.building, isActive: patch.isActive },
  });
}

export async function deriveHallCapacity(hallId: string): Promise<number> {
  return prisma.hallSeat.count({ where: { hallId, isActive: true } });
}

export async function getHallSeat(hallId: string, seatPosition: string) {
  const seat = await prisma.hallSeat.findUnique({
    where: { hallId_seatPosition: { hallId, seatPosition } },
  });
  if (!seat) throw new SeatingError("HallSeat not found", "HALL_SEAT_NOT_FOUND");
  return seat;
}

export async function setHallSeatActive(
  hallId: string,
  seatPosition: string,
  isActive: boolean,
) {
  await getHallSeat(hallId, seatPosition);
  return prisma.hallSeat.update({
    where: { hallId_seatPosition: { hallId, seatPosition } },
    data: { isActive },
  });
}