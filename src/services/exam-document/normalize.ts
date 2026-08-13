import { ExtractorConfig, NormalizationResult, NormalizationWarning, RawExtractedRow } from "./types";

export function normalizeRow(
  row: RawExtractedRow,
  config: ExtractorConfig,
  index: number,
): NormalizationResult {
  const warnings: NormalizationWarning[] = [];
  const rawRegister = row.rawRegisterNumber;
  const registerNumber = normalizeRegisterNumber(rawRegister, config);

  if (registerNumber !== rawRegister) {
    warnings.push({
      code: "REGISTER_NUMBER_FIXED",
      index,
      detail: `"${rawRegister}" -> "${registerNumber}"`,
    });
  }

  const name = normalizeName(row.nameTokens);

  return {
    index,
    registerNumber,
    name,
    warnings,
  };
}

export function normalizeRegisterNumber(value: string, config: ExtractorConfig): string {
  const cleaned = value.trim().toUpperCase();
  const match = cleaned.match(config.registerNumberCanonical);
  if (!match) return cleaned;
  return match[0];
}

export function normalizeName(tokens: string[]): string {
  const filtered = tokens.filter((token) => token.length > 0);
  return filtered.join(" ").replace(/\s+/g, " ").trim().toUpperCase();
}