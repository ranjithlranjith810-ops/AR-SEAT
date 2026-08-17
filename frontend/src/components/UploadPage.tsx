import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiError, uploadDocument } from "../lib/api";
import type { DocumentParseStatus, Exam, IngestReport } from "../lib/types";
import { isTerminalStatus } from "../lib/types";
import { Alert } from "./ui";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

type Phase =
  | "empty"
  | "selected"
  | "uploading"
  | "processing"
  | "completed"
  | "needsReview"
  | "rejected"
  | "failed";

interface SelectedFile {
  name: string;
  size: number;
}

function phaseFromStatus(status: DocumentParseStatus): Phase {
  switch (status) {
    case "PARSED":
      return "completed";
    case "NEEDS_REVIEW":
      return "needsReview";
    case "REJECTED":
      return "rejected";
    case "FAILED":
      return "failed";
    default:
      return "processing";
  }
}

export function UploadPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);

  const selection = location.state as { examId?: unknown; exam?: Exam } | null;
  const preselectedExam: Exam | null =
    selection && typeof selection.examId === "string" && selection.exam
      ? selection.exam
      : null;

  const [examId, setExamId] = useState(() =>
    selection && typeof selection.examId === "string" ? selection.examId : "",
  );
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [phase, setPhase] = useState<Phase>("empty");
  const [report, setReport] = useState<IngestReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = phase === "uploading" || phase === "processing";

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    if (!chosen) {
      setFile(null);
      setPhase("empty");
      return;
    }
    setFile({ name: chosen.name, size: chosen.size });
    setPhase("selected");
    setError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    const trimmedExamId = examId.trim();
    if (!trimmedExamId) {
      setPhase("selected");
      setError("Enter the exam ID for this document.");
      return;
    }
    const chosen = inputRef.current?.files?.[0];
    if (!chosen) {
      setPhase("empty");
      setError("Select a PDF file to upload.");
      return;
    }
    const validationError = validateClientSide(chosen);
    if (validationError) {
      setPhase("selected");
      setError(validationError);
      return;
    }

    setError(null);
    setPhase("uploading");
    try {
      const data = new Uint8Array(await chosen.arrayBuffer());
      const result = await uploadDocument(trimmedExamId, { name: chosen.name, data });
      setReport(result);
      setPhase(phaseFromStatus(result.finalParseStatus));
      if (!isTerminalStatus(result.finalParseStatus)) {
        // In practice ingestion is synchronous; if a non-terminal status is ever
        // returned, hand off to the status view which owns polling.
        navigate(`/documents/${result.documentId}`, { replace: true });
      }
    } catch (err) {
      setReport(null);
      setPhase("failed");
      setError(safeUploadError(err));
    }
  }

  function handleTryAgain() {
    setError(null);
    setReport(null);
    setPhase(file ? "selected" : "empty");
  }

  const completed = report && (phase === "completed" || phase === "needsReview");
  const unresolvedCount = report ? report.counts.rejected : 0;

  return (
    <div className="panel">
      <h1>Upload a document</h1>
      <p className="muted">
        Upload an exam PDF. Student rows are extracted and validated against the
        student master; the PDF is not treated as an authoritative student
        database.
      </p>

      {preselectedExam && (
        <div className="panel panel--inset">
          <h2>Selected exam</h2>
          <dl className="detail-list">
            <div>
              <dt>Exam ID</dt>
              <dd>{preselectedExam.id}</dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd>{formatDate(preselectedExam.examDate)}</dd>
            </div>
            <div>
              <dt>Session</dt>
              <dd>{preselectedExam.session}</dd>
            </div>
            <div>
              <dt>Exam type</dt>
              <dd>{preselectedExam.examType}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{preselectedExam.status}</dd>
            </div>
          </dl>
          <Link className="button button--ghost" to="/exams">
            Change exam
          </Link>
        </div>
      )}

      {phase === "failed" && (
        <Alert variant="danger">
          <p>{error}</p>
        </Alert>
      )}

      {phase === "completed" && report && (
        <Alert variant="success">
          <p>
            Processing complete. {report.candidatesPersisted} validated candidate
            record{report.candidatesPersisted === 1 ? "" : "s"} persisted.
          </p>
        </Alert>
      )}

      {phase === "needsReview" && report && (
        <Alert variant="warning">
          <p>
            This document was partially processed. {report.counts.matched} rows were
            matched to the student master; {unresolvedCount} row
            {unresolvedCount === 1 ? "" : "s"} could not be resolved and need
            attention before the document is considered fully ready.
          </p>
        </Alert>
      )}

      {phase === "rejected" && report && (
        <Alert variant="warning">
          <p>
            No rows from this document could be validated against the student
            master. Review the ingestion details to understand the outcome.
          </p>
        </Alert>
      )}

      {phase === "failed" && (
        <Alert variant="danger">
          <p>
            Something went wrong. Please try again. If the problem persists,
            contact your administrator.
          </p>
        </Alert>
      )}

      {report?.duplicate && (
        <Alert variant="info">
          <p>
            This document was already uploaded for this exam. You can{" "}
            <Link to={`/documents/${report.documentId}`}>view the existing ingestion record</Link>.
          </p>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="upload-form">
        <div className="field">
          <label htmlFor="examId">Exam ID</label>
          <input
            id="examId"
            name="examId"
            value={examId}
            onChange={(e) => setExamId(e.target.value)}
            disabled={busy || Boolean(preselectedExam)}
            placeholder="Exam identifier (UUID)"
            autoComplete="off"
            aria-describedby={error && phase === "selected" ? "upload-error" : undefined}
          />
        </div>

        <div className="field">
          <label htmlFor="pdf-file">PDF file</label>
          <input
            id="pdf-file"
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={handleFileChange}
            disabled={busy}
          />
        </div>

        {file ? (
          <p className="file-summary">
            <strong>{file.name}</strong> · {formatBytes(file.size)} · Ready to upload
          </p>
        ) : (
          <p className="file-summary muted">No document selected</p>
        )}

        {error && (phase === "empty" || phase === "selected") && (
          <div id="upload-error" role="alert" className="form-error">
            {error}
          </div>
        )}

        <div className="form-actions">
          <button type="submit" className="button button--primary" disabled={busy}>
            {phase === "uploading"
              ? "Uploading..."
              : phase === "processing"
                ? "Processing student records..."
                : "Upload document"}
          </button>
          {phase === "failed" && (
            <button type="button" className="button button--ghost" onClick={handleTryAgain}>
              Try again
            </button>
          )}
        </div>

        <div aria-live="polite" className="sr-only">
          {phase === "uploading" ? "Uploading document." : phase === "processing" ? "Processing student records." : ""}
        </div>
      </form>

      {completed && report && (
        <div className="upload-complete">
          <h2>Document uploaded</h2>
          <p>
            Ingestion status: <strong>{report.finalParseStatus}</strong>
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() => navigate(`/documents/${report.documentId}/candidates`)}
            >
              View candidates
            </button>
            <Link className="button button--ghost" to={`/documents/${report.documentId}`}>
              View ingestion status
            </Link>
          </div>
        </div>
      )}

      {(phase === "rejected" || phase === "failed") && report && (
        <div className="form-actions">
          <Link className="button button--ghost" to={`/documents/${report.documentId}`}>
            View ingestion status
          </Link>
        </div>
      )}
    </div>
  );
}

function validateClientSide(file: File): string | null {
  if (file.size === 0) return "The selected file is empty.";
  if (file.size > MAX_UPLOAD_BYTES) return "The selected file is larger than 20 MB.";
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf) return "Select a PDF file to upload.";
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function safeUploadError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "EXAM_NOT_FOUND":
        return "Exam not found. Check the exam ID.";
      case "INVALID_FILE_TYPE":
        return "The file was not accepted as a PDF.";
      case "EMPTY_UPLOAD":
        return "The selected file is empty.";
      case "PAYLOAD_TOO_LARGE":
        return "The file is larger than the 20 MB limit.";
      case "MISSING_EXAM_ID":
        return "Enter an exam ID.";
      case "UNAUTHORIZED":
        return "Your session has expired. Please log in again.";
      case "FORBIDDEN":
        return "You do not have permission to upload documents.";
      case "NETWORK_ERROR":
        return "Unable to reach the server. Please try again.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return "Something went wrong. Please try again.";
}