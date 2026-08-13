export interface StorageIntegrationConfig {
  storageIntegration?: string;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  supabaseStorageBucket?: string;
}

export type StorageIntegrationMode = "run" | "skip" | "fail";

export interface StorageIntegrationDecision {
  mode: StorageIntegrationMode;
  reason?: string;
}

/**
 * Gate for the real Supabase Storage integration suite.
 *
 * The real-storage suite must NEVER run merely because credentials exist in
 * .env. It only runs when STORAGE_INTEGRATION=1 is provided explicitly at run
 * time (CLI/CI). When integration is explicitly requested but configuration is
 * missing, the suite must FAIL clearly instead of silently skipping or falling
 * back to MemoryDocumentStore.
 *
 * STORAGE_INTEGRATION must not be persisted in .env; only the value passed to
 * this gate matters.
 */
export function resolveStorageIntegrationMode(
  config: StorageIntegrationConfig,
): StorageIntegrationDecision {
  if (config.storageIntegration !== "1") {
    return {
      mode: "skip",
      reason:
        "STORAGE_INTEGRATION is not '1', so the real Supabase Storage integration " +
        "suite is skipped. No live bucket access happens during the normal test run.",
    };
  }

  const missing: string[] = [];
  if (!config.supabaseUrl) missing.push("SUPABASE_URL");
  if (!config.supabaseServiceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!config.supabaseStorageBucket) missing.push("SUPABASE_STORAGE_BUCKET");

  if (missing.length > 0) {
    return {
      mode: "fail",
      reason:
        `STORAGE_INTEGRATION=1 was requested but required configuration is missing: ` +
        `${missing.join(", ")}. Real-storage integration must never fall back to ` +
        `MemoryDocumentStore. Set the missing variables and re-run.`,
    };
  }

  return {
    mode: "run",
    reason: "STORAGE_INTEGRATION=1 and required configuration are present.",
  };
}
