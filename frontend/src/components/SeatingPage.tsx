import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, getSeatingPlan } from "../lib/api";
import type { SeatingAssignment, SeatingPlan } from "../lib/types";
import { Alert, PageLoader } from "./ui";

export function SeatingPage() {
  const { seatingPlanId = "" } = useParams();
  const [plan, setPlan] = useState<SeatingPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getSeatingPlan(seatingPlanId)
      .then((next) => {
        if (cancelled) return;
        setPlan(next);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(safeSeatingError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [seatingPlanId, reloadKey]);

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    setReloadKey((k) => k + 1);
  }, []);

  if (loading && !plan) return <PageLoader label="Loading seating plan..." />;

  if (error && !plan) {
    return (
      <div className="panel">
        <h1>Seating plan</h1>
        <Alert variant="danger">{error}</Alert>
        <div className="form-actions">
          <button type="button" className="button button--ghost" onClick={retry}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!plan) return null;

  const halls = new Map<string, SeatingAssignment[]>();
  for (const assignment of plan.assignments) {
    const list = halls.get(assignment.hall.hallNumber) ?? [];
    list.push(assignment);
    halls.set(assignment.hall.hallNumber, list);
  }

  return (
    <div className="panel">
      <h1>Seating plan</h1>

      <dl className="detail-list">
        <div>
          <dt>Plan</dt>
          <dd>{plan.id}</dd>
        </div>
        <div>
          <dt>Exam</dt>
          <dd>{plan.examId}</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>{plan.version}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{plan.status}</dd>
        </div>
        <div>
          <dt>Assigned</dt>
          <dd>{plan.assignments.length}</dd>
        </div>
      </dl>

      {plan.assignments.length === 0 ? (
        <Alert variant="info">No seat assignments in this plan.</Alert>
      ) : (
        [...halls.entries()].map(([hallNumber, assignments]) => (
          <section key={hallNumber}>
            <h2>Hall {hallNumber}</h2>
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Seat assignments in hall {hallNumber}</caption>
                <thead>
                  <tr>
                    <th scope="col">Seat</th>
                    <th scope="col">Register number</th>
                    <th scope="col">Student</th>
                    <th scope="col">Class</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((assignment) => (
                    <tr key={assignment.id}>
                      <td>{assignment.hallSeat.seatPosition}</td>
                      <td>{assignment.examCandidate.registerNumberSnapshot}</td>
                      <td>{assignment.examCandidate.studentNameSnapshot}</td>
                      <td>{assignment.examCandidate.classSnapshot}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}

      <div className="form-actions">
        <Link className="button button--ghost" to="/">
          Back to home
        </Link>
      </div>
    </div>
  );
}

function safeSeatingError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "PLAN_NOT_FOUND":
        return "Seating plan not found.";
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