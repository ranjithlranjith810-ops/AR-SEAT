import {
  ExamDocumentHeader,
  ExtractorConfig,
  ExtractorResult,
  ExtractionWarning,
  PdfPageText,
  RawExtractedRow,
} from "./types";

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function detectHeader(line: string, config: ExtractorConfig): ExamDocumentHeader {
  const header: ExamDocumentHeader = {};
  const patterns = config.metadataPatterns;

  if (patterns.institution) {
    const m = line.match(patterns.institution);
    if (m && m[1]) header.institutionName = m[1].replace(/\s+/g, " ");
  }
  if (patterns.regulation) {
    const m = line.match(patterns.regulation);
    if (m && m[1]) header.regulation = m[1];
  }
  if (patterns.subjectCode) {
    const first = line.match(patterns.subjectCode)?.[1];
    if (first && !header.subjectCode) {
      header.subjectCode = first;
    }
  }
  if (patterns.subjectName) {
    const m = line.match(patterns.subjectName);
    if (m && m[2]) header.subjectName = m[2].trim();
  }
  if (patterns.date) {
    const m = line.match(patterns.date);
    if (m && m[1] && !header.examDate) header.examDate = m[1];
  }
  if (patterns.session) {
    const m = line.match(patterns.session);
    if (m && (m[0] === "FN" || m[0] === "AN")) header.session = m[0] as "FN" | "AN";
  }
  return header;
}

export function extractRowsFromText(
  pages: PdfPageText[],
  config: ExtractorConfig,
): ExtractorResult {
  const header: ExamDocumentHeader = {};
  const rows: RawExtractedRow[] = [];
  const warnings: ExtractionWarning[] = [];
  const seenSubjects = new Set<string>();

  for (const page of pages) {
    const lines = page.text.split(/\n+/);
    for (const rawLine of lines) {
      const line = collapseWhitespace(rawLine);
      if (!line) continue;

      const lineHeader = detectHeader(line, config);
      if (lineHeader.subjectCode) {
        if (header.subjectCode && header.subjectCode !== lineHeader.subjectCode) {
          warnings.push({ code: "UNMATCHED_LINE", detail: `Mixed subject codes in header: ${header.subjectCode} / ${lineHeader.subjectCode}` });
        }
        header.subjectCode = header.subjectCode ?? lineHeader.subjectCode;
        if (lineHeader.subjectName) header.subjectName = lineHeader.subjectName;
        seenSubjects.add(lineHeader.subjectCode);
      }
      if (lineHeader.examDate) header.examDate = header.examDate ?? lineHeader.examDate;
      if (lineHeader.session) header.session = lineHeader.session;
      if (lineHeader.institutionName) header.institutionName = header.institutionName ?? lineHeader.institutionName;
      if (lineHeader.regulation) header.regulation = header.regulation ?? lineHeader.regulation;

      if (!lineHasRegisterToken(line, config)) {
        continue;
      }

      const registerMatch = findRegisterToken(line, config);
      if (!registerMatch) continue;

      const hitStopToken = config.stopTokens.some((token) =>
        new RegExp(`\\b${escapeRegExp(token)}\\b`, "i").test(line),
      );
      if (hitStopToken && !registerMatch.isLikelyCandidate) continue;

      const nameTokens = line
        .split(/\s+/)
        .filter((t) => t.length > 0)
        .filter((t) => t !== registerMatch.value)
        .filter((t) => !/^(0*[1-9]\d{0,2}|00\d{1,3})$/i.test(t));
      rows.push({
        pageNumber: page.pageNumber,
        rawRegisterNumber: registerMatch.value,
        nameTokens,
      });
    }
  }

  if (rows.length === 0) {
    warnings.push({ code: "PAGE_HEADER_SKIPPED", detail: "No candidate rows detected on any page" });
  }
  if (seenSubjects.size > 1) {
    warnings.push({ code: "UNMATCHED_LINE", detail: `Document spans multiple subject codes: ${[...seenSubjects].join(", ")}` });
  }

  return { format: config.format, header, rows, warnings };
}

function lineHasRegisterToken(line: string, config: ExtractorConfig): boolean {
  return line.split(/\s+/).some((token) => config.registerNumberPattern.test(token));
}

function findRegisterToken(
  line: string,
  config: ExtractorConfig,
): { value: string; isLikelyCandidate: boolean } | undefined {
  const tokens = line.split(/\s+/);
  const registerToken = tokens.find((token) => config.registerNumberPattern.test(token));
  if (!registerToken) return undefined;
  const isLikelyCandidate = registerToken.length >= 6;
  return { value: registerToken, isLikelyCandidate };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}