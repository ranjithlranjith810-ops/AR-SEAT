import { ExtractorConfig, ExtractorFormat } from "./types";

/**
 * Default layout configuration for the common Anna University
 * candidate-list PDF format. The extractor is pattern-driven and NOT tied to a
 * single PDF: these heuristics are the tunable knob for the current layout.
 *
 * Supported representative layout as plain text (register number then name):
 *
 *   ANNA UNIVERSITY :: CHENNAI 600 025
 *   B.E./B.TECH DEGREE EXAMINATIONS, MAY/JUNE 2026
 *   REGULATIONS 2021
 *   SUBJECT CODE: CS8501  SUBJECT NAME: THEORY OF COMPUTATION
 *   DATE: 12.05.2026  SESSION: FN
 *   SL.NO  REGISTER NUMBER  CANDIDATE NAME
 *   001    953022104001     ANANTHA PRIYA S
 *   002    953022104002     KAVIN KUMAR P
 */
export const ANNA_UNIVERSITY_TEXT_TABLE_CONFIG: ExtractorConfig = {
  format: "ANNA_UNIVERSITY_TEXT_TABLE" as ExtractorFormat,
  registerNumberPattern: /^(DEMO-[A-Z]{2,4}-\d{3,5}|\d{6,14})$/i,
  registerNumberCanonical: /^(DEMO-[A-Z]{2,4}-\d{3,5}|\d{6,14})$/i,
  stopTokens: [
    "SL.NO",
    "SLNO",
    "REGISTER NUMBER",
    "REGISTRATION NUMBER",
    "CANDIDATE NAME",
    "CANDIDATES NAME",
    "UNIVERSITY",
    "REGULATIONS",
    "EXAMINATIONS",
    "SUBJECT CODE",
    "SUBJECT NAME",
    "ATTENDANCE",
    "PAGE",
    "ROLL NO",
    "ROLLNO",
    "COLLEGE",
    "PARTIAL",
    "BONAFIDE",
  ],
  metadataPatterns: {
    institution: /(ANNA UNIVERSITY\s*::?\s*[A-Z0-9 ,]+)/i,
    regulation: /\bREGULATIONS?\s+(\d{2,4})\b/i,
    subjectCode: /\b([A-Z]{1,4}\d{4})\b/,
    subjectName: /SUBJECT\s*(CODE|NAME)?\s*[:：-]\s*([A-Z][A-Z0-9 /&()'-]+)\s*(?=DATE|SESSION|$)/i,
    date: /\b(\d{1,2}\.\d{1,2}\.\d{4})\b/,
    session: /\b(FN|AN)\b/,
  },
};

export const GENERIC_TEXT_TABLE_CONFIG: ExtractorConfig = {
  format: "GENERIC_TEXT_TABLE" as ExtractorFormat,
  registerNumberPattern: /^(DEMO-[A-Z]{2,4}-\d{3,5}|\d{6,14})$/i,
  registerNumberCanonical: /^(DEMO-[A-Z]{2,4}-\d{3,5}|\d{6,14})$/i,
  stopTokens: [
    "SL.NO",
    "SLNO",
    "REGISTER NUMBER",
    "CANDIDATE NAME",
    "NAME",
    "ROLL NO",
    "PAGE",
    "SNO",
  ],
  metadataPatterns: {},
};

export const DEFAULT_EXTRACTOR_CONFIG: ExtractorConfig = ANNA_UNIVERSITY_TEXT_TABLE_CONFIG;