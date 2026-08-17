import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, getGenerationStatus } from "../lib/api";
import type { GenerationStatus } from "../lib/types";
import { isTerminalGenerationState } from "../lib/types";
import { Alert, PageLoader } from "./ui";

const POLL_MS = 2500;

export function GenerationStatusPage() {
  const { generationId = "" } = useParams();
  const [status, setStatus] = useState<GenerationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      if (cancelled) return;
      try {
        const next = await getGenerationStatus(generationId);
        if (cancelled) return;
        setStatus(next);
        setError(null);
        if (!isTerminalGenerationState(next.state)) {
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
  }, [generationId, reloadKey]);

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    setReloadKey((k) => k + 1);
  }, []);

  if (loading && !status) return <PageLoader label="Loading generation status..." />;

  if (error && !status) {
    return (
      <div className="panel">
        <h1>Generation status</h1>
        <Alert variant="danger">{error}</Alert>
        <div className="form-actions">
          <button type="button" className="button button--ghost" onClick={retry}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!status) return null;

  const terminal = isTerminalGenerationState(status.state);
  const completed = status.state === "COMPLETED";
  const failed = status.state.startsWith("FAILED");
  const cancelled = status.state === "CANCELLED";

  return (
    <div className="panel">
      <h1>Generation status</h1>

      {!terminal && (
        <Alert variant="info">
          <p>
            Seating generation is in progress. This view refreshes automatically
            until generation finishes.
          </p>
        </Alert>
      )}
      {completed && (
        <Alert variant="success">
          <p>Seating generation completed successfully.</p>
        </Alert>
      )}
      {failed && (
        <Alert variant="danger">
          <p>Seating generation failed.</p>
          {status.error?.code && <p>Reason: {status.error.code}</p>}
        </Alert>
      )}
      {cancelled && (
        <Alert variant="warning">
          <p>Seating generation was cancelled.</p>
        </Alert>
      )}

      <dl className="detail-list">
        <div>
          <dt>Generation</dt>
          <dd>{status.generationId}</dd>
        </div>
        <div>
          <dt>State</dt>
          <dd>{status.state}</dd>
        </div>
        <div>
          <dt>Candidates</dt>
          <dd>{status.sessionCandidateCount}</dd>
        </div>
        <div>
          <dt>Domains</dt>
          <dd>
            {status.completedDomainCount} of {status.domainCount} completed
          </dd>
        </div>
        {status.plan && (
          <>
            <div>
              <dt>Plan</dt>
              <dd>{status.plan.seatingPlanId ?? "—"}</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>{status.plan.version ?? "—"}</dd>
            </div>
            <div>
              <dt>Solver result</dt>
              <dd>{status.plan.solverStatus ?? "—"}</dd>
            </div>
            <div>
              <dt>Assignments</dt>
              <dd>
                {status.plan.assignedCount} assigned, {status.plan.unassignedCount}{" "}
                unassigned
              </dd>
            </div>
          </>
        )}
      </dl>

      {completed && status.plan?.seatingPlanId && (
        <div className="form-actions">
          <Link className="button button--primary" to={`/seating/${status.plan.seatingPlanId}`}>
            View seating plan
          </Link>
        </div>
      )}

      {error && <Alert variant="danger">{error}</Alert>}

      <div aria-live="polite" className="sr-only">
        {!terminal ? "Generation in progress." : ""}
      </div>
    </div>
  );
}

function safeStatusError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "GENERATION_NOT_FOUND":
        return "Generation not found.";
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