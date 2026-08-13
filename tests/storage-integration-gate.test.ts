import { describe, expect, it } from "vitest";
import { resolveStorageIntegrationMode } from "../src/services/exam-document/storage-integration";

const baseConfig = {
  supabaseUrl: "https://example.supabase.co",
  supabaseServiceRoleKey: "sb_secret_dummy",
  supabaseStorageBucket: "exam-documents",
};

describe("STORAGE_INTEGRATION gate", () => {
  it("skips the real-storage suite when STORAGE_INTEGRATION is not '1'", () => {
    const cases = [
      { ...baseConfig, storageIntegration: undefined },
      { ...baseConfig, storageIntegration: "" },
      { ...baseConfig, storageIntegration: "0" },
    ];
    for (const config of cases) {
      const decision = resolveStorageIntegrationMode(config);
      expect(decision.mode).toBe("skip");
      expect(decision.reason).toContain("STORAGE_INTEGRATION");
    }
    // Even with credentials present but no flag, the suite must skip.
    const noFlag = resolveStorageIntegrationMode({ ...baseConfig });
    expect(noFlag.mode).toBe("skip");
  });

  it("runs the real-storage suite only when STORAGE_INTEGRATION=1 and credentials are present", () => {
    const decision = resolveStorageIntegrationMode({
      ...baseConfig,
      storageIntegration: "1",
    });
    expect(decision.mode).toBe("run");
    expect(decision.reason).toContain("STORAGE_INTEGRATION=1");
  });

  it("fails (never skips) when STORAGE_INTEGRATION=1 but credentials are missing", () => {
    const cases = [
      { storageIntegration: "1" },
      { ...baseConfig, storageIntegration: "1", supabaseUrl: undefined },
      { ...baseConfig, storageIntegration: "1", supabaseServiceRoleKey: undefined },
      { ...baseConfig, storageIntegration: "1", supabaseStorageBucket: undefined },
    ];
    for (const config of cases) {
      const decision = resolveStorageIntegrationMode(config);
      expect(decision.mode).toBe("fail");
      expect(decision.reason).toContain("STORAGE_INTEGRATION=1");
      expect(decision.reason).toContain("must never fall back");
    }
  });

  it("names every missing variable without exposing secret values", () => {
    const decision = resolveStorageIntegrationMode({ storageIntegration: "1" });
    expect(decision.mode).toBe("fail");
    expect(decision.reason).toContain("SUPABASE_URL");
    expect(decision.reason).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(decision.reason).toContain("SUPABASE_STORAGE_BUCKET");
    // Secret values must never leak into diagnostics.
    expect(decision.reason).not.toContain("sb_secret_dummy");
    expect(decision.reason).not.toContain("example.supabase.co");
  });
});