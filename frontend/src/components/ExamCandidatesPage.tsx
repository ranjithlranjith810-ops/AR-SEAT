import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  addExamCandidate,
  ApiError,
  cancelExam,
  excludeExamCandidate,
  getExamCandidates,
  getExamConflicts,
  getExams,
  listStudents,
  reinstateExamCandidate,
} from "../lib/api";
import type {
  Candidate,
  Exam,
  ExamConflict,
  ExamCandidatePage,
  Student,
} from "../lib/types";
import { Alert, PageLoader } from "./ui";

const PAGE_SIZE = 20;
const STUDENT_SEARCH_LIMIT = 20;

export function ExamCandidatesPage() {
  const { examId = "" } = useParams();
  const [exam, setExam] = useState<Exam | null>(null);
  const [page, setPage] = useState<ExamCandidatePage | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [conflicts, setConflicts] = useState<ExamConflict[] | null>(null);
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [studentResults, setStudentResults] = useState<Student[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [addReason, setAddReason] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [excludeReasons, setExcludeReasons] = useState<Record<string, string>>({});
  const [excludingId, setExcludingId] = useState<string | null>(null);
  const [reinstatingId, setReinstatingId] = useState<string | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);

  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getExams(), getExamCandidates(examId, PAGE_SIZE, offset)])
      .then(([exams, data]) => {
        if (cancelled) return;
        setExam(exams.find((e) => e.id === examId) ?? null);
        setPage(data);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(safePageError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [examId, offset, reloadKey]);

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    setReloadKey((k) => k + 1);
  }, []);

  async function handleCheckConflicts() {
    if (checkingConflicts) return;
    setCheckingConflicts(true);
    setConflictError(null);
    try {
      const report = await getExamConflicts(examId);
      setConflicts(report.conflicts);
    } catch (err) {
      setConflictError(safeConflictError(err));
    } finally {
      setCheckingConflicts(false);
    }
  }

  async function handleSearchStudents() {
    if (searching) return;
    setSearching(true);
    setAddError(null);
    setSelectedStudentId("");
    try {
      const result = await listStudents({ search: searchTerm.trim(), limit: STUDENT_SEARCH_LIMIT });
      setStudentResults(result.students);
    } catch (err) {
      setAddError(safeAddError(err));
    } finally {
      setSearching(false);
    }
  }

  async function handleAdd() {
    if (!selectedStudentId || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      await addExamCandidate(examId, {
        studentId: selectedStudentId,
        reason: addReason.trim() || undefined,
      });
      setAddReason("");
      setSelectedStudentId("");
      setStudentResults(null);
      setSearchTerm("");
      setConflicts(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setAddError(safeAddError(err));
    } finally {
      setAdding(false);
    }
  }

  async function handleExclude(candidate: Candidate) {
    const reason = (excludeReasons[candidate.id] ?? "").trim();
    if (excludingId !== null || reason.length === 0) return;
    setExcludingId(candidate.id);
    setRosterError(null);
    try {
      await excludeExamCandidate(examId, candidate.id, reason);
      setExcludeReasons((prev) => ({ ...prev, [candidate.id]: "" }));
      setConflicts(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setRosterError(safeRosterError(err));
    } finally {
      setExcludingId(null);
    }
  }

  async function handleReinstate(candidate: Candidate) {
    if (reinstatingId !== null) return;
    setReinstatingId(candidate.id);
    setRosterError(null);
    try {
      await reinstateExamCandidate(examId, candidate.id);
      setConflicts(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setRosterError(safeRosterError(err));
    } finally {
      setReinstatingId(null);
    }
  }

  async function handleCancel() {
    if (cancelling) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const updated = await cancelExam(examId, cancelReason.trim() || undefined);
      setExam(updated);
    } catch (err) {
      setCancelError(safeCancelError(err));
    } finally {
      setCancelling(false);
    }
  }

  const firstLoad = loading && !page;

  if (firstLoad) return <PageLoader label="Loading exam candidates..." />;

  if (error && !page) {
    return (
      <div className="panel">
        <h1>Exam candidates</h1>
        <Alert variant="danger">{error}</Alert>
        <div className="form-actions">
          <button type="button" className="button button--ghost" onClick={retry}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!page) return null;

  const locked =
    exam?.status === "GENERATING" ||
    exam?.status === "APPROVED" ||
    exam?.status === "PUBLISHED" ||
    exam?.status === "CANCELLED";
  const cancellable =
    exam !== null && exam.status !== "PUBLISHED" && exam.status !== "CANCELLED";
  const first = page.total === 0 ? 0 : page.offset + 1;
  const last = Math.min(page.offset + page.limit, page.total);
  const canPrevious = page.offset > 0;
  const canNext = page.offset + page.limit < page.total;

  return (
    <div className="panel">
      <h1>Exam candidates</h1>

      {exam && (
        <dl className="detail-list">
          <div>
            <dt>Exam date</dt>
            <dd>{formatDate(exam.examDate)}</dd>
          </div>
          <div>
            <dt>Session</dt>
            <dd>{exam.session}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{exam.examType}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{exam.status}</dd>
          </div>
        </dl>
      )}

      {locked && (
        <Alert variant="warning">
          <p>This exam is {exam?.status}. The candidate roster is locked and cannot be changed.</p>
        </Alert>
      )}

      <section className="panel panel--subsection">
        <h2>Schedule conflicts</h2>
        <p className="muted">
          Detects students rostered for more than one exam on the same date and session.
        </p>
        <div className="form-actions">
          <button
            type="button"
            className="button button--primary"
            disabled={checkingConflicts}
            onClick={() => void handleCheckConflicts()}
          >
            {checkingConflicts ? "Checking..." : "Check conflicts"}
          </button>
        </div>
        {conflictError && <Alert variant="danger">{conflictError}</Alert>}
        {conflicts !== null &&
          (conflicts.length === 0 ? (
            <Alert variant="success">No schedule conflicts detected for this exam.</Alert>
          ) : (
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Schedule conflicts</caption>
                <thead>
                  <tr>
                    <th scope="col">Register number</th>
                    <th scope="col">Student</th>
                    <th scope="col">Conflicting exams</th>
                  </tr>
                </thead>
                <tbody>
                  {conflicts.map((conflict) => (
                    <tr key={conflict.studentId}>
                      <td>{conflict.registerNumber}</td>
                      <td>{conflict.studentName}</td>
                      <td>
                        {conflict.conflictingExams
                          .map((ref) => `${ref.examId} (${ref.subjectCode}, ${ref.validationStatus})`)
                          .join("; ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </section>

      <section className="panel panel--subsection">
        <h2>Add candidate from student master</h2>
        <p className="muted">
          Adds a student from the master record. The candidate enters as MATCHED and
          must be validated before generation.
        </p>
        {addError && <Alert variant="danger">{addError}</Alert>}
        <label className="field">
          <span>Search students</span>
          <div className="form-actions">
            <input
              id="student-search"
              type="search"
              value={searchTerm}
              disabled={locked || adding}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <button
              type="button"
              className="button button--ghost"
              disabled={locked || searching || searchTerm.trim().length === 0}
              onClick={() => void handleSearchStudents()}
            >
              {searching ? "Searching..." : "Search"}
            </button>
          </div>
        </label>
        {studentResults !== null && (
          <label className="field">
            <span>Student</span>
            <select
              id="student-select"
              value={selectedStudentId}
              disabled={locked || adding || studentResults.length === 0}
              onChange={(e) => setSelectedStudentId(e.target.value)}
            >
              <option value="">
                {studentResults.length === 0 ? "No students matched the search" : "Select a student"}
              </option>
              {studentResults.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.registerNumber} — {student.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>Reason for adding (audit)</span>
          <input
            id="candidate-reason"
            type="text"
            value={addReason}
            disabled={locked || adding}
            onChange={(e) => setAddReason(e.target.value)}
          />
        </label>
        <div className="form-actions">
          <button
            type="button"
            className="button button--primary"
            disabled={locked || adding || !selectedStudentId}
            onClick={() => void handleAdd()}
          >
            {adding ? "Adding..." : "Add candidate"}
          </button>
        </div>
      </section>

      <section className="panel panel--subsection">
        <h2>Candidate roster</h2>
        {rosterError && <Alert variant="danger">{rosterError}</Alert>}
        {page.total === 0 ? (
          <Alert variant="info">No candidates for this exam yet.</Alert>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Exam candidate roster</caption>
                <thead>
                  <tr>
                    <th scope="col">Register number</th>
                    <th scope="col">Student</th>
                    <th scope="col">Class</th>
                    <th scope="col">Department</th>
                    <th scope="col">Subject code</th>
                    <th scope="col">Validation</th>
                    <th scope="col">Exclusion reason</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {page.candidates.map((candidate) => {
                    const excluded = candidate.validationStatus === "REJECTED";
                    return (
                      <tr key={candidate.id}>
                        <td>{candidate.registerNumberSnapshot}</td>
                        <td>{candidate.studentNameSnapshot}</td>
                        <td>{candidate.classSnapshot}</td>
                        <td>{candidate.departmentSnapshot}</td>
                        <td>{candidate.subjectCode}</td>
                        <td>{candidate.validationStatus}</td>
                        <td>
                          {!excluded && (
                            <input
                              aria-label={`Exclusion reason for ${candidate.registerNumberSnapshot}`}
                              type="text"
                              value={excludeReasons[candidate.id] ?? ""}
                              disabled={locked || excludingId !== null}
                              onChange={(e) =>
                                setExcludeReasons((prev) => ({
                                  ...prev,
                                  [candidate.id]: e.target.value,
                                }))
                              }
                            />
                          )}
                        </td>
                        <td>
                          {excluded ? (
                            <button
                              type="button"
                              className="button button--ghost"
                              disabled={locked || reinstatingId !== null}
                              onClick={() => void handleReinstate(candidate)}
                            >
                              {reinstatingId === candidate.id ? "Reinstating..." : "Reinstate"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="button button--ghost"
                              disabled={
                                locked ||
                                excludingId !== null ||
                                (excludeReasons[candidate.id] ?? "").trim().length === 0
                              }
                              onClick={() => void handleExclude(candidate)}
                            >
                              {excludingId === candidate.id ? "Excluding..." : "Exclude"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
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
            </div>
          </>
        )}
      </section>

      <section className="panel panel--subsection">
        <h2>Cancel exam</h2>
        <p className="muted">
          Cancelling moves the exam to CANCELLED. Published seating plans are never deleted.
        </p>
        {cancelError && <Alert variant="danger">{cancelError}</Alert>}
        {cancellable ? (
          <>
            <label className="field">
              <span>Reason for cancellation (audit)</span>
              <input
                id="cancel-reason"
                type="text"
                value={cancelReason}
                disabled={cancelling}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="button button--ghost"
                disabled={cancelling}
                onClick={() => void handleCancel()}
              >
                {cancelling ? "Cancelling..." : "Cancel exam"}
              </button>
            </div>
          </>
        ) : (
          <Alert variant="info">
            This exam cannot be cancelled from its current state ({exam?.status}).
          </Alert>
        )}
      </section>

      <div className="form-actions">
        <Link className="button button--ghost" to="/exams">
          Back to exams
        </Link>
      </div>
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function safePageError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "EXAM_NOT_FOUND":
        return "Exam not found.";
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

function safeConflictError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "UNAUTHORIZED":
        return "Your session has expired. Please log in again.";
      case "NETWORK_ERROR":
        return "Unable to reach the server. Please try again.";
      default:
        return "Something went wrong while checking for conflicts.";
    }
  }
  return "Something went wrong while checking for conflicts.";
}

function safeAddError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "STUDENT_NOT_FOUND":
        return "Student not found in the master.";
      case "STUDENT_ALREADY_CANDIDATE":
        return "This student is already a candidate for the exam.";
      case "EXAM_NOT_MUTABLE":
        return "The exam roster is locked and cannot be changed.";
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

function safeRosterError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "INVALID_INPUT":
        return "An exclusion reason is required.";
      case "INVALID_VALIDATION_STATUS_TRANSITION":
        return "This candidate cannot be changed in its current state.";
      case "EXAM_NOT_MUTABLE":
        return "The exam roster is locked and cannot be changed.";
      case "CANDIDATE_NOT_FOUND":
        return "Candidate not found.";
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

function safeCancelError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "INVALID_EXAM_STATUS_TRANSITION":
        return "This exam cannot be cancelled from its current state.";
      case "EXAM_CANCELLATION_BLOCKED_ACTIVE_GENERATION":
        return "Cannot cancel while a seating generation is in progress.";
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