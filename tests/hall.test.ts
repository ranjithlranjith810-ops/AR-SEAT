import { describe, it, expect } from "vitest";
import { prisma } from "./setup";
import { expectUniqueViolation } from "./helpers";
import {
  createHall,
  deriveHallCapacity,
  setHallSeatActive,
} from "../src/services/hall.service";

describe("Hall", () => {
  it("can be created with configurable dimensions", async () => {
    const hall = await createHall({
      hallNumber: "LH10",
      name: "Lecture Hall 10",
      building: "North Block",
      rows: 4,
      columns: 3,
    });
    expect(hall).toMatchObject({ hallNumber: "LH10", rows: 4, columns: 3, isActive: true });
  });

  it("creates seats matching rows x columns and does not store capacity", async () => {
    const hall = await createHall({ hallNumber: "LH11", name: "LH 11", rows: 4, columns: 3 });
    const seats = await prisma.hallSeat.findMany({
      where: { hallId: hall.id },
      orderBy: { seatPosition: "asc" },
    });
    expect(seats).toHaveLength(12);
    expect(seats[0]?.seatPosition).toBe("A1");
    expect(new Set(seats.map((s) => s.seatPosition)).size).toBe(12);
    expect("capacity" in hall).toBe(false);
  });

  it("rejects a duplicate seat position within a hall", async () => {
    const hall = await createHall({ hallNumber: "LH12", name: "LH 12", rows: 2, columns: 2 });
    await expectUniqueViolation(
      prisma.hallSeat.create({
        data: { hallId: hall.id, seatPosition: "A1", row: "A", column: 1, isActive: true },
      }),
    );
  });

  it("derives capacity from active HallSeat records", async () => {
    const hall = await createHall({ hallNumber: "LH13", name: "LH 13", rows: 5, columns: 5 });
    const capacity = await deriveHallCapacity(hall.id);
    expect(capacity).toBe(25);
  });

  it("excludes inactive seats from capacity", async () => {
    const hall = await createHall({ hallNumber: "LH14", name: "LH 14", rows: 5, columns: 5 });
    await setHallSeatActive(hall.id, "A1", false);
    await setHallSeatActive(hall.id, "B3", false);
    await setHallSeatActive(hall.id, "E5", false);
    const capacity = await deriveHallCapacity(hall.id);
    expect(capacity).toBe(22);
  });

  it("provides active seats used by the solver input builder", async () => {
    const hall = await createHall({ hallNumber: "LH15", name: "LH 15", rows: 3, columns: 3 });
    await setHallSeatActive(hall.id, "C3", false);
    const activeSeats = await prisma.hallSeat.count({
      where: { hallId: hall.id, isActive: true },
    });
    expect(activeSeats).toBe(8);
  });
});