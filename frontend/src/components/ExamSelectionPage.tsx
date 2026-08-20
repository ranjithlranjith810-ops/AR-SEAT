import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, getExams } from "../lib/api";
import type { Exam } from "../lib/types";
import { Alert, PageLoader } from "./ui";

export function ExamSelectionPage() {
  const navigate = useNavigate();
  const [exams, setExams] = useState<Exam[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getExams()
      .then((list) => {
        if (cancelled) return;
        setExams(list);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(safeExamError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    setReloadKey((k) => k + 1);
  }, []);

  function selectExam(exam: Exam) {
    navigate("/upload", { state: { examId: exam.id, exam } });
  }

  if (loading && !exams) return <PageLoader label="Loading exams..." />;

  if (error && !exams) {
    return (
      <div className="panel">
        <h1>Select an exam</h1>
        <Alert variant="danger">{error}</Alert>
        <div className="form-actions">
          <button type="button" className="button button--ghost" onClick={retry}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!exams) return null;

  return (
    <div className="panel">
      <h1>Select an exam</h1>
      <p className="muted">
        Choose the exam the uploaded document belongs to. Exam details come from
        the backend; the PDF itself is never treated as an authoritative student
        database.
      </p>

      {exams.length === 0 ? (
        <Alert variant="info">No exams found.</Alert>
      ) : (
        <div className="exam-list">
          {exams.map((exam) => (
            <div key={exam.id} className="exam-row">
              <div className="exam-row__meta">
                <strong>{formatDate(exam.examDate)}</strong>
                <span>{exam.session}</span>
                <span>{exam.examType}</span>
                <span className={`exam-status exam-status--${exam.status.toLowerCase()}`}>
                  {exam.status}
                </span>
              </div>
              <div className="form-actions">
                <Link className="button button--ghost" to={`/exams/${exam.id}/candidates`}>
                  Manage candidates
                </Link>
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => selectExam(exam)}
                >
                  Select
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function safeExamError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
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
