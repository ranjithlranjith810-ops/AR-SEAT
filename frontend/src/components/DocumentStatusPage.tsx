import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, getDocument, getDocumentCandidates } from "../lib/api";
import type { UploadedDocument } from "../lib/types";
import { isTerminalStatus } from "../lib/types";
import { Alert, PageLoader, StatusBadge } from "./ui";

const POLL_MS = 3000;
const COUNT_PAGE_SIZE = 1;

export function DocumentStatusPage() {
  const { documentId = "" } = useParams();
  const [document, setDocument] = useState<UploadedDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [matchedCount, setMatchedCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      if (cancelled) return;
      try {
        const doc = await getDocument(documentId);
        if (cancelled) return;
        setDocument(doc);
        setError(null);
        if (!isTerminalStatus(doc.parseStatus)) {
          timer = setTimeout(tick, POLL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        setError(safeStatusError(err));
        // Stop polling on failure; the Retry action re-runs the effect.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    setLoading(true);
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [documentId, reloadKey]);

useEffect(() => {
    if (document?.parseStatus !== "NEEDS_REVIEW") return;
    let cancelled = false;
    setMatchedCount(null);
    Promise.resolve()
      .then(() => getDocumentCandidates(documentId, COUNT_PAGE_SIZE, 0))
      .then((data) => {
        if (!cancelled) setMatchedCount(data.total);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [documentId, document?.parseStatus]);

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    setReloadKey((k) => k + 1);
  }, []);

  if (loading && !document) return <PageLoader label="Loading ingestion status..." />;

  if (error && !document) {
    return (
      <div className="panel">
        <Alert variant="danger">{error}</Alert>
        <div className="form-actions">
          <button type="button" className="button button--ghost" onClick={retry}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!document) return null;

  const needsReview = document.parseStatus === "NEEDS_REVIEW";
  const rejected = document.parseStatus === "REJECTED";
  const failed = document.parseStatus === "FAILED";
  const processing = !isTerminalStatus(document.parseStatus);
  const unresolved = needsReview ? unresolvedFromMetadata(document.parseMetadata) : null;

  return (
    <div className="panel">
      <h1>Ingestion status</h1>

      {processing && (
        <Alert variant="info">
          <p>Processing student records. This view refreshes automatically until processing finishes.</p>
        </Alert>
      )}
      {needsReview && (
        <div className="alert alert--warning review-summary" role="status">
          <div className="alert__title">NEEDS_REVIEW</div>
          <div className="alert__body">
            <dl className="review-counts">
              {matchedCount !== null && (
                <div>
                  <dt>Matched candidates</dt>
                  <dd>{matchedCount}</dd>
                </div>
              )}
              {unresolved !== null && (
                <div>
                  <dt>Unresolved rows</dt>
                  <dd>{unresolved}</dd>
                </div>
              )}
            </dl>
            <p>
              This document is partially processed. The unresolved rows require
              attention before the document is considered fully ready for the
              next workflow step.
            </p>
            {unresolved !== null && (
              <p>
                The document contains {unresolved} row{unresolved === 1 ? "" : "s"} that
                could not be matched against the Student Master.
              </p>
            )}
            <div className="form-actions">
              <Link
                className="button button--primary"
                to={`/documents/${document.id}/candidates`}
              >
                {matchedCount !== null ? `View ${matchedCount} candidates` : "View candidates"}
              </Link>
            </div>
          </div>
        </div>
      )}
      {rejected && (
        <Alert variant="warning">
          <p>No rows from this document could be validated against the student master.</p>
        </Alert>
      )}
      {failed && (
        <Alert variant="danger">
          <p>Processing failed. Something went wrong while reading this document.</p>
        </Alert>
      )}
      {document.parseStatus === "PARSED" && (
        <Alert variant="success">
          <p>Processing complete. Candidates are ready for review.</p>
        </Alert>
      )}

      <dl className="detail-list">
        <div>
          <dt>Document</dt>
          <dd>{document.id}</dd>
        </div>
        <div>
          <dt>Exam</dt>
          <dd>{document.examId}</dd>
        </div>
        <div>
          <dt>Filename</dt>
          <dd>{document.fileName}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            <StatusBadge status={document.parseStatus} />
          </dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatDateTime(document.createdAt)}</dd>
        </div>
        <div>
          <dt>Last updated</dt>
          <dd>{formatDateTime(document.updatedAt)}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(document.fileSize)}</dd>
        </div>
      </dl>

      {rejected && typeof document.parseMetadata === "string" && (
        <p className="muted">Reason: {document.parseMetadata}</p>
      )}

      {document.parseStatus === "PARSED" && (
        <div className="form-actions">
          <Link className="button button--primary" to={`/documents/${document.id}/candidates`}>
            View candidates
          </Link>
        </div>
      )}

      <div aria-live="polite" className="sr-only">
        {processing ? "Processing student records." : ""}
      </div>
    </div>
  );
}

// Reads only numeric issue-counts from the backend's structured metadata. Never
// surfaces raw extracted PDF text or internal exception details.
function unresolvedFromMetadata(meta: unknown): number | null {
  if (typeof meta !== "object" || meta === null) return null;
  const issues = (meta as { issues?: unknown }).issues;
  if (typeof issues !== "object" || issues === null) return null;
  let total = 0;
  for (const value of Object.values(issues as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) total += value;
  }
  return total > 0 ? total : null;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeStatusError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "DOCUMENT_NOT_FOUND":
        return "Document not found.";
      case "UNAUTHORIZED":
        return "Your session has expired. Please log in again.";
      case "NETWORK_ERROR":
        return "Unable to reach the server. Please try again.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return "Something went wrong. Please try again.";
}