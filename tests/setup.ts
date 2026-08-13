import { beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { seedDatabase } from "../prisma/seed";
import { prisma } from "../src/db";
import { resetTestDatabase, verifyTestDatabase } from "./helpers";

beforeAll(async () => {
  await verifyTestDatabase(prisma);
  await resetTestDatabase(prisma);
  await seedDatabase(prisma);
}, 180000);

afterAll(async () => {
  await prisma.$disconnect();
});

export type { PrismaClient };
export { prisma };