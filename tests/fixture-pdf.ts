import { PDFDocument, StandardFonts } from "pdf-lib";

export interface FixtureRow {
  serial: string;
  registerNumber: string;
  name: string;
}

export interface FixtureOptions {
  institution?: string;
  regulation?: string;
  subjectCode?: string;
  subjectName?: string;
  date?: string;
  session?: string;
}

export function annaFixtureLines(
  rows: FixtureRow[],
  options: FixtureOptions = {},
): string[] {
  const {
    institution = "ANNA UNIVERSITY :: CHENNAI 600 025",
    regulation = "REGULATIONS 2021",
    subjectCode = "CS8501",
    subjectName = "THEORY OF COMPUTATION",
    date = "12.05.2026",
    session = "FN",
  } = options;

  const lines = [
    institution,
    "B.E./B.TECH DEGREE EXAMINATIONS, MAY/JUNE 2026",
    regulation,
    `SUBJECT CODE: ${subjectCode}  SUBJECT NAME: ${subjectName}`,
    `DATE: ${date}  SESSION: ${session}`,
    "SL.NO  REGISTER NUMBER  CANDIDATE NAME",
  ];
  for (const row of rows) {
    lines.push(`${row.serial}\t${row.registerNumber}\t${row.name}`);
  }
  return lines;
}

export function genericFixtureLines(rows: FixtureRow[]): string[] {
  return [
    "SL.NO  REGISTER NUMBER  CANDIDATE NAME",
    ...rows.map((row) => `${row.serial}\t${row.registerNumber}\t${row.name}`),
  ];
}

export async function buildPdf(lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedStandardFont(StandardFonts.Helvetica);
  let y = 770;
  for (const line of lines) {
    page.drawText(line.replace(/\t/g, "     "), { x: 60, y, size: 10, font });
    y -= 22;
  }
  return doc.save();
}

export interface FixtureGroup {
  institution: string;
  regulation: string;
  subjectCode: string;
  subjectName: string;
  date: string;
  session: string;
  rows: FixtureRow[];
}

export async function buildMultiPagePdf(groups: FixtureGroup[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedStandardFont(StandardFonts.Helvetica);
  for (const group of groups) {
    const page = doc.addPage([595, 842]);
    let y = 770;
    const lines = [
      group.institution,
      "B.E./B.TECH DEGREE EXAMINATIONS, MAY/JUNE 2026",
      group.regulation,
      `SUBJECT CODE: ${group.subjectCode}  SUBJECT NAME: ${group.subjectName}`,
      `DATE: ${group.date}  SESSION: ${group.session}`,
      "SL.NO  REGISTER NUMBER  CANDIDATE NAME",
    ];
    for (const line of lines) {
      page.drawText(line.replace(/\t/g, "     "), { x: 60, y, size: 10, font });
      y -= 22;
    }
    for (const row of group.rows) {
      page.drawText(`${row.serial}     ${row.registerNumber}     ${row.name}`, {
        x: 60,
        y,
        size: 10,
        font,
      });
      y -= 22;
    }
  }
  return doc.save();
}