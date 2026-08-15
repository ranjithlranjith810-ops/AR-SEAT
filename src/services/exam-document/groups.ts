/**
 * Phase 4 — multi-group document segmentation (Module A).
 *
 * Real Anna University attendance PDFs often span MULTIPLE exams in one file:
 * several subject codes, sessions (FN/AN) and dates. The single-header
 * extractor (extract.ts) treats the whole file as one exam and only warns.
 * This module segments the page stream into discrete exam groups keyed by
 * (subjectCode, session, date) so each group can be validated and seated
 * independently. The single-group extractor is left unchanged.
 */
import { detectHeader, collapseWhitespace } from "./extract";
import type {
  ExamDocumentHeader,
  ExtractorConfig,
  ExtractionWarning,
  PdfPageText,
  RawExtractedRow,
} from "./types";

export interface DocumentGroup {
  groupIndex: number;
  header: ExamDocumentHeader;
  rows: RawExtractedRow[];
  pageRange: { first: number; last: number };
  warnings: ExtractionWarning[];
  /** True when the group header is missing subject/session context. */
  incompleteHeader: boolean;
}

export interface GroupSegmentationResult {
  groups: DocumentGroup[];
  warnings: ExtractionWarning[];
  /** True when segmentation could not be resolved cleanly (STOP signal). */
  ambiguous: boolean;
}

function groupKey(header: ExamDocumentHeader): string {
  return [header.subjectCode, header.session, header.examDate]
    .map((v) => v ?? "<none>")
    .join("|");
}

export function segmentDocumentIntoGroups(
  pages: PdfPageText[],
  config: ExtractorConfig,
): GroupSegmentationResult {
  const warnings: ExtractionWarning[] = [];
  const groups: DocumentGroup[] = [];
  let current: DocumentGroup | null = null;
  let ambiguous = false;

  const closeCurrent = (lastPage: number) => {
    if (!current) return;
    current.pageRange.last = lastPage;
    groups.push(current);
    current = null;
  };

  for (const page of pages) {
    const lines = page.text.split(/\n+/);
    for (const rawLine of lines) {
      const line = collapseWhitespace(rawLine);
      if (!line) continue;

      const lineHeader = detectHeader(line, config);
      const hasNewSubject = lineHeader.subjectCode !== undefined;
      const hasNewContext =
        lineHeader.examDate !== undefined || lineHeader.session !== undefined;

      if (hasNewSubject && current) {
        // A new exam group begins on this line (a subject header always
        // starts a group; a group may legitimately contain zero rows).
        closeCurrent(page.pageNumber);
      }

      if (hasNewSubject || hasNewContext) {
        if (!current) {
          const header: ExamDocumentHeader = {
            institutionName: lineHeader.institutionName,
            regulation: lineHeader.regulation,
            subjectCode: lineHeader.subjectCode,
            subjectName: lineHeader.subjectName,
            examDate: lineHeader.examDate,
            session: lineHeader.session,
          };
          const key = groupKey(header);
          const existing = groups.find((g) => groupKey(g.header) === key);
          if (existing && current === null && groups.length > 0) {
            // Same group resumed after another group — keep going (non-contiguous).
            current = existing;
          } else {
            current = {
              groupIndex: groups.length,
              header,
              rows: [],
              pageRange: { first: page.pageNumber, last: page.pageNumber },
              warnings: [],
              incompleteHeader: !header.subjectCode,
            };
          }
        } else {
          // Merge header context into the active group (subject names, dates).
          current.header.subjectCode = current.header.subjectCode ?? lineHeader.subjectCode;
          current.header.subjectName = current.header.subjectName ?? lineHeader.subjectName;
          current.header.examDate = current.header.examDate ?? lineHeader.examDate;
          current.header.session = current.header.session ?? lineHeader.session;
        }
        continue;
      }

      if (!current) {
        if (!isCandidateLine(line, config)) {
          // Preamble (college name, regulations, page footers) before the
          // first subject header — skip silently, it carries no rows.
          continue;
        }
        // Candidate rows before any exam header — ambiguous grouping (STOP).
        ambiguous = true;
        warnings.push({
          code: "UNMATCHED_LINE",
          detail: `page ${page.pageNumber}: candidate rows appear before any exam group header`,
        });
        current = {
          groupIndex: groups.length,
          header: {},
          rows: [],
          pageRange: { first: page.pageNumber, last: page.pageNumber },
          warnings: [
            { code: "PAGE_HEADER_SKIPPED", detail: "rows grouped without an exam header" },
          ],
          incompleteHeader: true,
        };
      }

      if (!isCandidateLine(line, config)) continue;
      const registerToken = findRegisterToken(line, config);
      if (!registerToken) continue;

      const hitStopToken = config.stopTokens.some((token) =>
        new RegExp(`\\b${escapeRegExp(token)}\\b`, "i").test(line),
      );
      if (hitStopToken && !registerToken.isLikelyCandidate) continue;

      const nameTokens = line
        .split(/\s+/)
        .filter((t) => t.length > 0)
        .filter((t) => t !== registerToken.value)
        .filter((t) => !/^(0*[1-9]\d{0,2}|00\d{1,3})$/i.test(t));
      current.rows.push({
        pageNumber: page.pageNumber,
        rawRegisterNumber: registerToken.value,
        nameTokens,
      });
    }
  }

  closeCurrent(pages.length ? pages[pages.length - 1]!.pageNumber : 0);

  const seenKeys = new Set<string>();
  for (const group of groups) {
    const key = groupKey(group.header);
    if (seenKeys.has(key) && group.header.subjectCode) {
      warnings.push({
        code: "UNMATCHED_LINE",
        detail: `group ${group.groupIndex}: non-contiguous segments for ${key}`,
      });
    }
    seenKeys.add(key);
  }

  if (groups.length === 0) {
    warnings.push({
      code: "PAGE_HEADER_SKIPPED",
      detail: "No candidate rows detected in any page",
    });
  }

  return { groups, warnings, ambiguous };
}

export function summarizeGroups(result: GroupSegmentationResult) {
  return {
    groupCount: result.groups.length,
    ambiguous: result.ambiguous,
    groups: result.groups.map((g) => ({
      groupIndex: g.groupIndex,
      subjectCode: g.header.subjectCode ?? null,
      subjectName: g.header.subjectName ?? null,
      examDate: g.header.examDate ?? null,
      session: g.header.session ?? null,
      rowCount: g.rows.length,
      pageRange: g.pageRange,
      incompleteHeader: g.incompleteHeader,
    })),
  };
}

function isCandidateLine(line: string, config: ExtractorConfig): boolean {
  return line
    .split(/\s+/)
    .some((token) => config.registerNumberPattern.test(token));
}

function findRegisterToken(
  line: string,
  config: ExtractorConfig,
): { value: string; isLikelyCandidate: boolean } | undefined {
  const tokens = line.split(/\s+/);
  const registerToken = tokens.find((token) =>
    config.registerNumberPattern.test(token),
  );
  if (!registerToken) return undefined;
  return { value: registerToken, isLikelyCandidate: registerToken.length >= 6 };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}