import { useCallback, useEffect, useState } from "react";
import { ApiError, getAuditLogs } from "../lib/api";
import { AUDIT_ACTIONS, type AuditLogItem } from "../lib/types";
import { Alert, PageLoader } from "./ui";

const PAGE_SIZE = 20;

export function AuditPage() {
  const [items, setItems] = useState<AuditLogItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [actorId, setActorId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAuditLogs({
      limit: PAGE_SIZE,
      offset,
      action: action || undefined,
      entityType: entityType || undefined,
      entityId: entityId || undefined,
      actorId: actorId || undefined,
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(to).toISOString() : undefined,
    })
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setTotal(page.total);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(safeAuditError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [offset, action, entityType, entityId, actorId, from, to, reloadKey]);

  function applyFilters() {
    setOffset(0);
    setReloadKey((k) => k + 1);
  }

  function resetFilters() {
    setAction("");
    setEntityType("");
    setEntityId("");
    setActorId("");
    setFrom("");
    setTo("");
    setOffset(0);
    setReloadKey((k) => k + 1);
  }

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    setReloadKey((k) => k + 1);
  }, []);

  if (loading && !items) return <PageLoader label="Loading audit log..." />;

  if (error && !items) {
    return (
      <div className="panel">
        <h1>Audit log</h1>
        <Alert variant="danger">{error}</Alert>
        <div className="form-actions">
          <button type="button" className="button button--ghost" onClick={retry}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!items) return null;

  const hasNext = offset + items.length < total;
  const hasPrev = offset > 0;

  return (
    <div className="panel">
      <h1>Audit log</h1>
      <p className="muted">
        Chronological, read-only record of administrative actions.
      </p>

      <form
        className="audit-filters"
        onSubmit={(event) => {
          event.preventDefault();
          applyFilters();
        }}
      >
        <label className="field">
          <span>Action</span>
          <select value={action} onChange={(event) => setAction(event.target.value)}>
            <option value="">Any</option>
            {AUDIT_ACTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Entity type</span>
          <input
            type="text"
            value={entityType}
            onChange={(event) => setEntityType(event.target.value)}
            placeholder="e.g. Exam"
          />
        </label>
        <label className="field">
          <span>Entity id</span>
          <input
            type="text"
            value={entityId}
            onChange={(event) => setEntityId(event.target.value)}
            placeholder="entity id"
          />
        </label>
        <label className="field">
          <span>Actor id</span>
          <input
            type="text"
            value={actorId}
            onChange={(event) => setActorId(event.target.value)}
            placeholder="user id"
          />
        </label>
        <label className="field">
          <span>From</span>
          <input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="field">
          <span>To</span>
          <input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <div className="form-actions audit-filters__actions">
          <button type="submit" className="button button--primary">
            Apply
          </button>
          <button type="button" className="button button--ghost" onClick={resetFilters}>
            Reset
          </button>
        </div>
      </form>

      {items.length === 0 ? (
        <Alert variant="info">No audit entries match the current filters.</Alert>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Action</th>
                <th>Entity</th>
                <th>Entity id</th>
                <th>Actor</th>
                <th>Created at</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.action}</td>
                  <td>{item.entityType}</td>
                  <td className="mono">{item.entityId}</td>
                  <td>{item.actor ? `${item.actor.username} (${item.actor.role})` : "—"}</td>
                  <td>{formatDateTime(item.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="pagination">
        <p className="pagination__summary">
          Showing {total === 0 ? 0 : offset + 1}–{Math.min(offset + items.length, total)} of {total}
        </p>
        <div className="pagination__actions">
          <button
            type="button"
            className="button button--ghost"
            disabled={!hasPrev}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Previous
          </button>
          <button
            type="button"
            className="button button--ghost"
            disabled={!hasNext}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function safeAuditError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "UNAUTHORIZED":
        return "Your session has expired. Please log in again.";
      case "FORBIDDEN":
        return "You do not have permission to view the audit log.";
      case "NETWORK_ERROR":
        return "Unable to reach the server. Please try again.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return "Something went wrong. Please try again.";
}
