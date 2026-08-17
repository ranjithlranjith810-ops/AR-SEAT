import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, getDocument, getDocumentCandidates } from "../lib/api";
import type { CandidatePage as CandidatePageData, UploadedDocument } from "../lib/types";
import { Alert, PageLoader } from "./ui";

const PAGE_SIZE = 20;

export function CandidatePage() {
  const { documentId = "" } = useParams();
  const [document, setDocument] = useState<UploadedDocument | null>(null);
  const [page, setPage] = useState<CandidatePageData | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getDocument(documentId), getDocumentCandidates(documentId, PAGE_SIZE, offset)])
      .then(([doc, data]) => {
        if (cancelled) return;
        setDocument(doc);
        setPage(data);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(safeCandidateError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, offset]);

  const firstLoad = loading && !page;

  if (firstLoad) return <PageLoader label="Loading candidates..." />;

  if (error && !page) {
    return (
      <div className="panel">
        <h1>Candidates</h1>
        <Alert variant="danger">{error}</Alert>
      </div>
    );
  }

  if (!page) return null;

  const needsReview = document?.parseStatus === "NEEDS_REVIEW";
  const first = page.total === 0 ? 0 : page.offset + 1;
  const last = Math.min(page.offset + page.limit, page.total);
  const canPrevious = page.offset > 0;
  const canNext = page.offset + page.limit < page.total;

  return (
    <div className="panel">
      <h1>Candidates</h1>
      <p className="muted">
        Candidate rows are validated against the student master. Names and academic
        information are master-sourced, not taken from the uploaded PDF.
      </p>

      {needsReview && (
        <Alert variant="warning">
          <p>
            This document is partially processed. Only matched candidates are shown
            below; unresolved rows require attention before generation.
          </p>
        </Alert>
      )}

      {page.total === 0 ? (
        <Alert variant="info">No candidates found for this document.</Alert>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Validated candidates</caption>
              <thead>
                <tr>
                  <th scope="col">Register number</th>
                  <th scope="col">Student</th>
                  <th scope="col">Class</th>
                  <th scope="col">Department</th>
                  <th scope="col">Subject code</th>
                  <th scope="col">Validation</th>
                </tr>
              </thead>
              <tbody>
                {page.candidates.map((candidate) => (
                  <tr key={candidate.id}>
                    <td>{candidate.registerNumberSnapshot}</td>
                    <td>{candidate.studentNameSnapshot}</td>
                    <td>{candidate.classSnapshot}</td>
                    <td>{candidate.departmentSnapshot}</td>
                    <td>{candidate.subjectCode}</td>
                    <td>{candidate.validationStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <p className="pagination__summary">
              Showing {first}–{last} of {page.total}
            </p>
            <div className="pagination__actions">
              <button
                type="button"
                className="button button--ghost"
                disabled={!canPrevious || loading}
                onClick={() => setOffset(Math.max(0, page.offset - PAGE_SIZE))}
              >
                Previous
              </button>
              <button
                type="button"
                className="button button--ghost"
                disabled={!canNext || loading}
                onClick={() => setOffset(page.offset + PAGE_SIZE)}
              >
                Next
              </button>
            </div>
            <span aria-live="polite" className="sr-only">
              {loading ? "Updating candidates." : ""}
            </span>
          </div>
        </>
      )}

      <div className="form-actions">
        <Link className="button button--ghost" to={`/documents/${documentId}`}>
          Back to ingestion status
        </Link>
      </div>
    </div>
  );
}

function safeCandidateError(err: unknown): string {
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