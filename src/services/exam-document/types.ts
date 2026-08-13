import { DocumentParseStatus } from "@prisma/client";

export interface PdfPageText {
  pageNumber: number;
  text: string;
}

export interface ExamDocumentHeader {
  institutionName?: string;
  regulation?: string;
  subjectCode?: string;
  subjectName?: string;
  examDate?: string;
  session?: "FN" | "AN";
}

export interface RawExtractedRow {
  pageNumber: number;
  rawRegisterNumber: string;
  nameTokens: string[];
}

export type ExtractorFormat = "ANNA_UNIVERSITY_TEXT_TABLE" | "GENERIC_TEXT_TABLE";

export type ExtractorWarningCode = "PAGE_HEADER_SKIPPED" | "UNMATCHED_LINE";

export interface ExtractionWarning {
  code: ExtractorWarningCode;
  detail: string;
}

export type NormalizationWarningCode = "REGISTER_NUMBER_FIXED";

export interface NormalizationWarning {
  code: NormalizationWarningCode;
  index: number;
  detail: string;
}

export interface NormalizationResult {
  index: number;
  registerNumber: string;
  name: string;
  warnings: NormalizationWarning[];
}

export interface ExtractorResult {
  format: ExtractorFormat;
  header: ExamDocumentHeader;
  rows: RawExtractedRow[];
  warnings: ExtractionWarning[];
}

export interface NormalizedCandidate {
  rowIndex: number;
  pageNumber: number;
  registerNumber: string;
  name: string;
}

export type ValidationIssueCode =
  | "MISSING_REGISTER_NUMBER"
  | "MISSING_NAME"
  | "INVALID_REGISTER_NUMBER"
  | "DUPLICATE_IN_DOCUMENT"
  | "DUPLICATE_IN_EXAM"
  | "STUDENT_NOT_FOUND"
  | "NAME_MISMATCH"
  | "STUDENT_INACTIVE";

export interface ValidationIssue {
  code: ValidationIssueCode;
  detail?: string;
}

export type CandidateValidationStatus = "VALIDATED" | "MATCHED" | "REJECTED";

export interface CandidateValidationOutcome {
  rowIndex: number;
  registerNumber: string;
  name: string;
  status: CandidateValidationStatus;
  studentId?: string;
  issues: ValidationIssue[];
  blocking: boolean;
}

export type FinalParseStatus = Exclude<
  DocumentParseStatus,
  "UPLOADED" | "PROCESSING"
>;

export interface IngestReport {
  documentId: string;
  finalParseStatus: FinalParseStatus;
  counts: {
    extractedRows: number;
    normalized: number;
    validated: number;
    matched: number;
    rejected: number;
  };
  issuesByCode: Record<string, number>;
  candidatesPersisted: number;
  header: ExamDocumentHeader;
  warnings: ExtractionWarning[];
  duplicate: boolean;
  existingDocumentId?: string;
}

export interface ExtractorConfig {
  format: ExtractorFormat;
  registerNumberPattern: RegExp;
  registerNumberCanonical: RegExp;
  stopTokens: string[];
  metadataPatterns: {
    institution?: RegExp;
    regulation?: RegExp;
    subjectCode?: RegExp;
    subjectName?: RegExp;
    date?: RegExp;
    session?: RegExp;
  };
}