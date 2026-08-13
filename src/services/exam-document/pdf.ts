import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PdfPageText } from "./types";

function resolveWorkerSource(): string {
  let resolved: string;
  if (typeof import.meta.resolve === "function") {
    try {
      resolved = import.meta.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
    } catch {
      resolved = createRequire(import.meta.url).resolve(
        "pdfjs-dist/legacy/build/pdf.worker.mjs",
      );
    }
  } else {
    resolved = createRequire(import.meta.url).resolve(
      "pdfjs-dist/legacy/build/pdf.worker.mjs",
    );
  }
  // Normalize to a file:// URL: pdfjs constructs a Worker from workerSrc and
  // Node requires absolute paths as file:// URLs (a bare "D:\..." is treated
  // as an unknown "d:" protocol).
  return resolved.startsWith("file:") ? resolved : pathToFileURL(resolved).href;
}

const workerSource = resolveWorkerSource();
GlobalWorkerOptions.workerSrc = workerSource;

export async function extractPdfText(pdfData: Uint8Array): Promise<PdfPageText[]> {
  // pdfjs transfers the input buffer to its (fake) worker and detaches it.
  // Clone so the caller's bytes stay usable for repeated analysis/hashing.
  const data = new Uint8Array(pdfData);
  const task = getDocument({
    data,
    useSystemFonts: true,
  });
  const document = await task.promise;

  const pages: PdfPageText[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = reconstructLines(
        content.items as unknown as { str?: unknown; transform?: unknown }[],
      );
      pages.push({ pageNumber, text });
    }
  } finally {
    await task.destroy();
  }
  return pages;
}

// pdfjs flattens all text items in reading order; lines must be rebuilt by
// grouping items that share the same baseline (transform[5] is the y offset).
function reconstructLines(items: { str?: unknown; transform?: unknown }[]): string {
  const LINE_TOLERANCE = 2;
  const lines: { y: number; parts: { x: number; str: string }[] }[] = [];

  for (const item of items) {
    if (typeof item.str !== "string") continue;
    const str = item.str;
    if (str.length === 0) continue;
    const transform = Array.isArray(item.transform) ? item.transform : [];
    const y = transform[5] ?? 0;
    const x = transform[4] ?? 0;
    const existing = lines.find((line) => Math.abs(line.y - y) <= LINE_TOLERANCE);
    if (existing) {
      existing.parts.push({ x, str });
    } else {
      lines.push({ y, parts: [{ x, str }] });
    }
  }

  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) =>
      line.parts
        .sort((a, b) => a.x - b.x)
        .map((part) => part.str)
        .join(" "),
    )
    .join("\n");
}