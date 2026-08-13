import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SupabaseDocumentStore, sha256 } from "../src/services/exam-document/upload";
import { getSupabaseClient, resetSupabaseClient } from "../src/supabase";
import {
  resolveStorageIntegrationMode,
  StorageIntegrationDecision,
} from "../src/services/exam-document/storage-integration";
import { buildPdf, annaFixtureLines } from "./fixture-pdf";

const decision: StorageIntegrationDecision = resolveStorageIntegrationMode({
  storageIntegration: process.env.STORAGE_INTEGRATION,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  supabaseStorageBucket: process.env.SUPABASE_STORAGE_BUCKET,
});

// Normal test runs (no STORAGE_INTEGRATION=1) must skip the live suite entirely.
// Explicit STORAGE_INTEGRATION=1 with broken configuration must FAIL (beforeAll).
const describeImpl = decision.mode === "skip" ? describe.skip : describe;

describeImpl("SupabaseDocumentStore (real private bucket)", () => {
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "exam-documents";
  // Isolated namespace: never touches production examination document paths.
  const namespace = `integration-tests/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const store = new SupabaseDocumentStore(bucket);

  const createdKeys: string[] = [];
  const cleanupFailures: string[] = [];

  function track(key: string): string {
    createdKeys.push(key);
    return key;
  }

  // Deletes a test artifact and proves it is gone using the fixed exists()
  // implementation (info()), which handles nested keys correctly.
  async function cleanupKey(key: string): Promise<void> {
    try {
      await store.delete(key);
    } catch (error) {
      cleanupFailures.push(
        `delete() failed for "${key}": ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    try {
      const gone = !(await store.exists(key));
      if (!gone) {
        cleanupFailures.push(`object still present after delete(): "${key}"`);
      }
    } catch (error) {
      cleanupFailures.push(
        `exists() check after delete() failed for "${key}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  beforeAll(() => {
    if (decision.mode === "fail") {
      throw new Error(
        decision.reason ??
          "STORAGE_INTEGRATION=1 but required Supabase configuration is missing.",
      );
    }
  });

  // Cleanup runs after every test, including after a failed/asserting body.
  // A leftover artifact is a visible failure, never a silent leak.
  afterEach(async () => {
    for (const key of createdKeys) {
      await cleanupKey(key);
    }
    createdKeys.length = 0;
    if (cleanupFailures.length > 0) {
      const detail = cleanupFailures.join("\n");
      cleanupFailures.length = 0;
      throw new Error(
        `Integration-test cleanup failed. The artifact storage keys below must be removed manually.\n${detail}`,
      );
    }
  });

  afterAll(async () => {
    resetSupabaseClient();
  });

  it("stores, downloads, verifies SHA-256, signed-URLs and removes a test object", async () => {
    const lines = annaFixtureLines([
      { serial: "001", registerNumber: "7330230410001", name: "ANANTHA PRIYA S" },
    ]);
    const pdf = await buildPdf(lines);
    const expectedHash = sha256(pdf);
    const key = track(`${namespace}/sample.pdf`);

    try {
      const upload = await store.put(key, pdf);
      expect(upload.ok).toBe(true);
      expect(upload.key).toBe(key);

      expect(await store.exists(key)).toBe(true);

      const retrieved = await store.get(key);
      expect(retrieved).not.toBeNull();
      expect(sha256(retrieved!)).toBe(expectedHash);

      const meta = await store.metadata(key);
      expect(meta?.size).toBe(pdf.length);

      // Signed URL must actually serve the bytes without the service-role key.
      const url = await store.signedUrl(key, 60);
      expect(url).toMatch(/^https:\/\//);
      const signedResponse = await fetch(url, { method: "GET", redirect: "follow" });
      expect(signedResponse.ok).toBe(true);
      const signedBytes = new Uint8Array(await signedResponse.arrayBuffer());
      expect(sha256(signedBytes)).toBe(expectedHash);
    } finally {
      await cleanupKey(key);
    }

    // Post-delete verification using the fixed exists() implementation.
    expect(await store.exists(key)).toBe(false);
  });

  it("does not expose the uploaded PDF through an anonymous public URL", async () => {
    const lines = annaFixtureLines([
      { serial: "001", registerNumber: "7330230410001", name: "ANANTHA PRIYA S" },
    ]);
    const pdf = await buildPdf(lines);
    const key = track(`${namespace}/private-sample.pdf`);

    try {
      await store.put(key, pdf);

      const anon = getSupabaseClient().storage.from(bucket);
      const { data } = anon.getPublicUrl(key);
      const publicUrl = data.publicUrl;
      const response = await fetch(publicUrl, { method: "GET", redirect: "follow" });
      // Private bucket: unauthenticated public fetch must NOT return the PDF bytes.
      expect(response.ok).toBe(false);
    } finally {
      await cleanupKey(key);
    }

    expect(await store.exists(key)).toBe(false);
  });

  it("cleans up the test object even when an assertion fails mid-test", async () => {
    const lines = annaFixtureLines([
      { serial: "001", registerNumber: "7330230410001", name: "ANANTHA PRIYA S" },
    ]);
    const pdf = await buildPdf(lines);
    const key = track(`${namespace}/failure-path-sample.pdf`);

    let assertionFailed = false;
    try {
      await store.put(key, pdf);
      expect(await store.exists(key)).toBe(true);
      // Controlled failure: simulates an assertion throwing mid-test. The
      // finally block below must still run and remove the object.
      expect("FAILURE_ON_PURPOSE").toBe(true);
    } catch (error) {
      assertionFailed = true;
      expect(error).toBeTruthy();
    } finally {
      await cleanupKey(key);
    }

    // The failure path was exercised AND the object is gone afterwards.
    expect(assertionFailed).toBe(true);
    expect(await store.exists(key)).toBe(false);
  });
});