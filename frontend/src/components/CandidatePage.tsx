import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, generateSeating, getDocument, getDocumentCandidates, resolveCandidate } from "../lib/api";
import type { CandidatePage as CandidatePageData, UploadedDocument } from "../lib/types";
import { useAuth } from "../auth/AuthContext";
import { Alert, PageLoader } from "./ui";

const PAGE_SIZE = 20;

export function CandidatePage() {
  const { documentId = "" } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [document, setDocument] = useState<UploadedDocument | null>(null);
  const [page, setPage] = useState<CandidatePageData | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);

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

  const isAdmin = user?.role === "ADMIN";
  const needsReview = document?.parseStatus === "NEEDS_REVIEW";
  const first = page.total === 0 ? 0 : page.offset + 1;
  const last = Math.min(page.offset + page.limit, page.total);
  const canPrevious = page.offset > 0;
  const canNext = page.offset + page.limit < page.total;

  async function handleGenerate() {
    if (!document || generating) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const created = await generateSeating(document.examId);
      navigate(`/generations/${created.generationId}`);
    } catch (err) {
      setGenerateError(safeGenerateError(err));
    } finally {
      setGenerating(false);
    }
  }

  async function handleResolve(candidateId: string) {
    if (!document || resolvingId) return;
    setResolvingId(candidateId);
    setResolveError(null);
    try {
      const updated = await resolveCandidate(document.id, candidateId);
      setPage((prev) =>
        prev
          ? { ...prev, candidates: prev.candidates.map((c) => (c.id === updated.id ? updated : c)) }
          : prev,
      );
    } catch (err) {
      setResolveError(safeResolveError(err));
    } finally {
      setResolvingId(null);
    }
  }

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
                  <th scope="col">Action</th>
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
                    <td>
                      {isAdmin && candidate.validationStatus === "MATCHED" && (
                        <button
                          type="button"
                          className="button button--ghost"
                          disabled={resolvingId !== null}
                          onClick={() => void handleResolve(candidate.id)}
                        >
                          {resolvingId === candidate.id ? "Resolving..." : "Resolve"}
                        </button>
                      )}
                    </td>
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

      {generateError && <Alert variant="danger">{generateError}</Alert>}
      {resolveError && <Alert variant="danger">{resolveError}</Alert>}

      {isAdmin && (
        <div className="form-actions">
          <button
            type="button"
            className="button button--primary"
            disabled={generating}
            onClick={() => void handleGenerate()}
          >
            {generating ? "Generating seating..." : "Generate seating"}
          </button>
          <p className="muted">
            Generation reconciles this document's candidates against the student
            master before producing a seating plan.
          </p>
        </div>
      )}

      <div className="form-actions">
        <Link className="button button--ghost" to={`/documents/${documentId}`}>
          Back to ingestion status
        </Link>
      </div>
    </div>
  );
}

function safeGenerateError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "ERR_JOB_ALREADY_ACTIVE":
        return "A seating generation for this exam is already in progress.";
      case "MISSING_EXAM_ID":
        return "Exam information is missing. Please upload the document again.";
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

function safeResolveError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "CANDIDATE_NOT_FOUND":
        return "Candidate not found.";
      case "INVALID_VALIDATION_STATUS_TRANSITION":
        return "This candidate cannot be resolved in its current state.";
      case "UNAUTHORIZED":
        return "Your session has expired. Please log in again.";
      case "FORBIDDEN":
        return "You do not have permission to resolve candidates.";
      case "NETWORK_ERROR":
        return "Unable to reach the server. Please try again.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return "Something went wrong. Please try again.";
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