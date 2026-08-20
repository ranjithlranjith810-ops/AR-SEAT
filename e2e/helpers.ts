import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

export interface SeedState {
  admin: { username: string; password: string };
  staff: { username: string; password: string };
  goldenExam: { id: string };
  roleExam: { id: string };
  roleDocument: { id: string; parseStatus: string };
  conflictExam: { id: string };
  manageExam: { id: string };
  cancelExam: { id: string };
  auditPlan: { entityId: string };
}

export function loadSeedState(): SeedState {
  const file = process.env.E2E_SEED_STATE;
  if (!file) throw new Error("E2E_SEED_STATE env var is required");
  return JSON.parse(readFileSync(file, "utf8")) as SeedState;
}

export async function login(page: Page, username: string, password: string): Promise<void> {
  await page.goto("/#/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/Document ingestion/)).toBeVisible();
}

export function apiUrl(path: string): string {
  return `${process.env.E2E_BACKEND_URL ?? "http://localhost:8787"}${path}`;
}
