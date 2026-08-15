/**
 * Phase 4 — Proforma 1 PDF generation (§14).
 *
 * Renders the published seating plan in the Anna University PROFORMA-1 style:
 * a per-hall 5-column x 5-row grid, subject-wise counts, a hall allocation
 * summary page and a grand total. Uses pdf-lib (Helvetica standard font, no
 * assets required). The generator is pure (no DB); it consumes a normalized
 * view of the validated plan so it can be tested with a round-trip extraction.
 */
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

export interface ProformaCell {
  registerNumber: string;
  department: string;
}

export interface ProformaHall {
  hallNumber: string;
  /** Grid columns keyed A..Z (one entry per hall column). */
  grid: Record<string, ProformaCell[]>;
  subjectCounts: Record<string, number>;
  total: number;
}

export interface Proforma1Input {
  institutionName: string;
  examTitle: string;
  examDate: string;
  session: "FN" | "AN";
  halls: ProformaHall[];
  grandTotal: number;
}

export interface Proforma1Output {
  pdf: Uint8Array;
  pageCount: number;
  hallPageIndices: Record<string, number[]>;
  summaryPageIndex: number;
}

const COLUMNS_PER_PAGE = 5;
const ROWS_PER_PAGE = 5;

function columnKey(index: number): string {
  let s = "";
  let i = index;
  do {
    s = String.fromCharCode(65 + (i % 26)) + s;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return s;
}

export async function generateProforma1(input: Proforma1Input): Promise<Proforma1Output> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const hallPageIndices: Record<string, number[]> = {};

  // Total pages = sum over halls of (column groups x row groups) + 1 summary.
  const totalGridPages = input.halls.reduce((sum, hall) => {
    const columns = Math.max(1, Object.keys(hall.grid).length);
    const rows = Math.max(1, ...Object.values(hall.grid).map((cells) => cells.length));
    return sum + Math.ceil(columns / COLUMNS_PER_PAGE) * Math.ceil(rows / ROWS_PER_PAGE);
  }, 0);
  const totalPages = totalGridPages + 1;

  let pageNumber = 0;
  for (const hall of input.halls) {
    const columnKeys = Object.keys(hall.grid);
    const columns = Math.max(1, columnKeys.length);
    const rows = Math.max(1, ...columnKeys.map((k) => hall.grid[k]!.length));
    const hallPages: number[] = [];
    hallPageIndices[hall.hallNumber] = hallPages;
    for (let colStart = 0; colStart < columns; colStart += COLUMNS_PER_PAGE) {
      const colEnd = Math.min(columns, colStart + COLUMNS_PER_PAGE);
      for (let rowStart = 0; rowStart < rows; rowStart += ROWS_PER_PAGE) {
        const rowEnd = Math.min(rows, rowStart + ROWS_PER_PAGE);
        const page = doc.addPage([612, 792]);
        pageNumber += 1;
        drawHallPage(
          doc,
          page,
          font,
          fontBold,
          input,
          hall,
          columnKeys.slice(colStart, colEnd),
          rowStart,
          rowEnd,
          pageNumber,
          totalPages,
        );
        hallPages.push(pageNumber - 1);
      }
    }
  }

  const summaryPageIndex = pageNumber;
  const summaryPage = doc.addPage([612, 792]);
  drawHallAllocationPage(doc, summaryPage, font, fontBold, input);

  const pdf = await doc.save();

  return {
    pdf,
    pageCount: doc.getPageCount(),
    hallPageIndices,
    summaryPageIndex,
  };
}

function drawHallPage(
  doc: PDFDocument,
  page: PDFPage,
  font: PDFFont,
  fontBold: PDFFont,
  input: Proforma1Input,
  hall: ProformaHall,
  columnKeys: string[],
  rowStart: number,
  rowEnd: number,
  pageNumber: number,
  totalPages: number,
) {
  const { width } = page.getSize();
  const center = (text: string, y: number, size: number, f: PDFFont = font) => {
    const w = f.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (width - w) / 2, y, size, font: f });
  };

  center(input.institutionName, 720, 14, fontBold);
  center("PROFORMA - 1", 700, 12, fontBold);
  center(input.examTitle, 682, 11);
  center(`${input.examDate}  ${input.session === "FN" ? "Forenoon (F.N.)" : "Afternoon (A.N.)"}`, 664, 11);
  center(`HALL NO: ${hall.hallNumber}${rowStart > 0 ? " (cont.)" : ""}`, 640, 12, fontBold);

  const headerY = 610;
  const colWidth = 96;
  const rowHeight = 34;
  const gridX = (width - COLUMNS_PER_PAGE * colWidth) / 2;
  const gridTop = headerY;

  // Column headers (the window of 5 columns rendered on this page)
  columnKeys.forEach((key, i) => {
    page.drawText(key, {
      x: gridX + i * colWidth + colWidth / 2 - 4,
      y: gridTop,
      size: 12,
      font: fontBold,
    });
    page.drawRectangle({
      x: gridX + i * colWidth,
      y: gridTop - 6,
      width: colWidth,
      height: 6,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
  });

  // Rows within this page's window (row labels 1..5, global rows rowStart..rowEnd)
  for (let r = rowStart; r < rowEnd; r++) {
    const local = r - rowStart;
    const rowLabel = String(r + 1);
    page.drawText(rowLabel, {
      x: gridX - 22,
      y: gridTop - (local + 1) * rowHeight + 10,
      size: 10,
      font: fontBold,
    });
    columnKeys.forEach((key, c) => {
      const x = gridX + c * colWidth;
      const y = gridTop - (local + 1) * rowHeight;
      page.drawRectangle({
        x,
        y,
        width: colWidth,
        height: rowHeight,
        borderColor: rgb(0, 0, 0),
        borderWidth: 1,
      });
      const cells = hall.grid[key];
      const cell = cells?.[r];
      if (cell) {
        page.drawText(cell.registerNumber, {
          x: x + 6,
          y: y + rowHeight - 12,
          size: 7,
          font,
        });
        page.drawText(cell.department, {
          x: x + 6,
          y: y + 6,
          size: 7,
          font,
        });
      }
    });
  }

  const subjectLine = Object.entries(hall.subjectCounts)
    .map(([code, count]) => `${code}-${count}`)
    .join(", ");
  page.drawText(`SUBJECT WISE COUNT: ${subjectLine}`, {
    x: 60,
    y: 150,
    size: 10,
    font: fontBold,
  });
  page.drawText(`TOTAL CANDIDATES: ${hall.total}`, {
    x: 60,
    y: 132,
    size: 10,
    font: fontBold,
  });

  // Signature blocks
  page.drawText(`Page ${pageNumber} of ${totalPages}`, {
    x: 60,
    y: 40,
    size: 9,
    font,
  });
  page.drawText("Superintendent", { x: 380, y: 40, size: 9, font });
  page.drawText("Chief Superintendent", { x: 480, y: 40, size: 9, font });
}

function drawHallAllocationPage(
  doc: PDFDocument,
  page: PDFPage,
  font: PDFFont,
  fontBold: PDFFont,
  input: Proforma1Input,
) {
  const { width } = page.getSize();
  const center = (text: string, y: number, size: number, f: PDFFont = font) => {
    const w = f.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (width - w) / 2, y, size, font: f });
  };

  center("HALL ALLOCATION", 720, 14, fontBold);
  center(input.examTitle, 700, 11);
  center(`${input.examDate}  ${input.session === "FN" ? "Forenoon (F.N.)" : "Afternoon (A.N.)"}`, 682, 11);

  const startY = 640;
  const rowHeight = 18;
  page.drawText("S.No", { x: 60, y: startY, size: 10, font: fontBold });
  page.drawText("Hall No", { x: 130, y: startY, size: 10, font: fontBold });
  page.drawText("Subject-wise Count", { x: 220, y: startY, size: 10, font: fontBold });
  page.drawText("Total", { x: 520, y: startY, size: 10, font: fontBold });

  input.halls.forEach((hall, index) => {
    const y = startY - (index + 1) * rowHeight;
    const subjectLine = Object.entries(hall.subjectCounts)
      .map(([code, count]) => `${code}-${count}`)
      .join(", ");
    page.drawText(String(index + 1), { x: 60, y, size: 9, font });
    page.drawText(hall.hallNumber, { x: 130, y, size: 9, font });
    page.drawText(subjectLine, { x: 220, y, size: 9, font });
    page.drawText(String(hall.total), { x: 520, y, size: 9, font });
  });

  const grandY = startY - (input.halls.length + 1) * rowHeight;
  page.drawText(`GRAND TOTAL`, { x: 380, y: grandY, size: 12, font: fontBold });
  page.drawText(String(input.grandTotal), { x: 520, y: grandY, size: 12, font: fontBold });

  page.drawText("Page Last", { x: 60, y: 40, size: 9, font });
  page.drawText("Superintendent", { x: 380, y: 40, size: 9, font });
  page.drawText("Chief Superintendent", { x: 480, y: 40, size: 9, font });
}

/**
 * Builds the Proforma-1 view from a published plan (from persist.getSeatingPlanForExam).
 * Grid cell placement: column index (1-based, mapped to A..E) and seat row.
 */
export interface ProformaPlanHall {
  hallNumber: string;
  rows: number;
  columns: number;
}

export interface ProformaPlanAssignment {
  registerNumber: string;
  department: string;
  seatRow: number;
  seatColumn: number;
  hallNumber: string;
}

/**
 * Builds the Proforma-1 view from a persisted SeatingPlan (the authoritative
 * source of truth — never from a temporary in-memory structure). Matches the
 * shape returned by persist.getSeatingPlanForExam.
 */
export interface PersistedPlanHallMeta {
  hallNumber: string;
  rows: number;
  columns: number;
}

export interface PersistedPlanAssignment {
  examCandidate: { registerNumberSnapshot: string; departmentSnapshot: string };
  hall: PersistedPlanHallMeta;
  hallSeat: { row: string; column: number };
}

export function buildProformaInputFromPlan(
  exam: {
    examDate: Date;
    session: "FN" | "AN";
    institutionName?: string | null;
  },
  plan: { assignments: PersistedPlanAssignment[] },
): Proforma1Input {
  const hallMeta = new Map<string, PersistedPlanHallMeta>();
  for (const assignment of plan.assignments) {
    hallMeta.set(assignment.hall.hallNumber, assignment.hall);
  }
  const dateText =
    exam.examDate instanceof Date
      ? `${String(exam.examDate.getDate()).padStart(2, "0")}.${String(exam.examDate.getMonth() + 1).padStart(2, "0")}.${exam.examDate.getFullYear()}`
      : String(exam.examDate);

  return buildProformaInput(
    {
      institutionName: exam.institutionName ?? undefined,
      title: "University Examinations",
      date: dateText,
      session: exam.session,
    },
    [...hallMeta.values()],
    plan.assignments.map((a) => ({
      registerNumber: a.examCandidate.registerNumberSnapshot,
      department: a.examCandidate.departmentSnapshot,
      seatRow: a.hallSeat.row.toUpperCase().charCodeAt(0) - 64,
      seatColumn: a.hallSeat.column,
      hallNumber: a.hall.hallNumber,
    })),
  );
}

export function buildProformaInput(
  exam: { institutionName?: string; title?: string; date?: string; session?: "FN" | "AN" },
  hallMeta: ProformaPlanHall[],
  assignments: ProformaPlanAssignment[],
): Proforma1Input {
  const institutionName = exam.institutionName ?? "Anna University";
  const examTitle = exam.title ?? "University Examinations";
  const examDate = exam.date ?? "";
  const session = exam.session ?? "AN";

  const halls = hallMeta.map((meta) => {
    const columns = Math.max(1, meta.columns ?? 5);
    const grid: Record<string, ProformaCell[]> = {};
    for (let c = 0; c < columns; c++) grid[columnKey(c)] = [];
    const cells = assignments.filter((a) => a.hallNumber === meta.hallNumber);
    for (const cell of cells) {
      const columnKeyLabel = columnKey(Math.max(0, cell.seatColumn - 1));
      const rows = grid[columnKeyLabel] ?? grid[columnKey(0)]!;
      while (rows.length < cell.seatRow) {
        rows.push({ registerNumber: "", department: "" });
      }
      rows[cell.seatRow - 1] = { registerNumber: cell.registerNumber, department: cell.department };
    }
    const subjectCounts: Record<string, number> = {};
    for (const cell of cells) {
      const dept = cell.department || "OTHER";
      subjectCounts[dept] = (subjectCounts[dept] ?? 0) + 1;
    }
    return {
      hallNumber: meta.hallNumber,
      grid,
      subjectCounts,
      total: cells.length,
    };
  });

  const grandTotal = assignments.length;

  return {
    institutionName,
    examTitle,
    examDate,
    session,
    halls,
    grandTotal,
  };
}