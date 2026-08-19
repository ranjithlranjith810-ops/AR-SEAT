import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  assignSeatToBench,
  createBench,
  createHall,
  listHalls,
  removeSeatFromBench,
  setBenchActive,
  updateHall,
} from "../lib/api";
import type { Hall, HallBench, HallSeat } from "../lib/types";
import { Alert, PageLoader } from "./ui";

export function HallsPage() {
  const [halls, setHalls] = useState<Hall[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const [showCreateHall, setShowCreateHall] = useState(false);
  const [hallForm, setHallForm] = useState({
    hallNumber: "",
    name: "",
    building: "",
    rows: "5",
    columns: "5",
  });
  const [formError, setFormError] = useState<string | null>(null);

  const [benchDrafts, setBenchDrafts] = useState<Record<string, string>>({});
  const [seatPick, setSeatPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listHalls()
      .then((rows) => {
        if (cancelled) return;
        setHalls(rows);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(safeHallError(err));
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

  const flash = useCallback((message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 4000);
  }, []);

  async function handleCreateHall() {
    setFormError(null);
    const rows = Number(hallForm.rows);
    const columns = Number(hallForm.columns);
    if (!hallForm.hallNumber.trim() || !hallForm.name.trim()) {
      setFormError("Hall number and name are required.");
      return;
    }
    if (!Number.isInteger(rows) || rows < 1 || !Number.isInteger(columns) || columns < 1) {
      setFormError("Rows and columns must be positive whole numbers.");
      return;
    }
    setBusy("create-hall");
    try {
      await createHall({
        hallNumber: hallForm.hallNumber.trim(),
        name: hallForm.name.trim(),
        building: hallForm.building.trim() || null,
        rows,
        columns,
      });
      setShowCreateHall(false);
      setHallForm({ hallNumber: "", name: "", building: "", rows: "5", columns: "5" });
      flash(`Hall ${hallForm.hallNumber.trim()} created`);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setFormError(safeHallError(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleToggleHall(hall: Hall) {
    setError(null);
    try {
      await updateHall(hall.id, { isActive: !hall.isActive });
      flash(`${hall.hallNumber} ${hall.isActive ? "deactivated" : "activated"}`);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(safeHallError(err));
    }
  }

  async function handleCreateBench(hall: Hall) {
    const benchNumber = (benchDrafts[hall.id] ?? "").trim();
    if (!benchNumber) {
      setError("Bench number is required.");
      return;
    }
    setBusy(`bench-${hall.id}`);
    try {
      await createBench(hall.id, { benchNumber });
      setBenchDrafts((d) => ({ ...d, [hall.id]: "" }));
      flash(`Bench ${benchNumber} added to ${hall.hallNumber}`);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(safeHallError(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleToggleBench(bench: HallBench, hall: Hall) {
    setError(null);
    setBusy(`toggle-${bench.id}`);
    try {
      await setBenchActive(bench.id, !bench.isActive);
      flash(`Bench ${bench.benchNumber} in ${hall.hallNumber} ${bench.isActive ? "deactivated" : "activated"}`);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(safeHallError(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleAssignSeat(bench: HallBench) {
    const seatId = seatPick[bench.id];
    if (!seatId) return;
    setBusy(`assign-${bench.id}`);
    try {
      await assignSeatToBench(bench.id, seatId);
      setSeatPick((p) => ({ ...p, [bench.id]: "" }));
      flash(`Seat added to bench ${bench.benchNumber}`);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(safeHallError(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleRemoveSeat(bench: HallBench, seat: HallSeat) {
    setBusy(`remove-${bench.id}-${seat.id}`);
    try {
      await removeSeatFromBench(bench.id, seat.id);
      flash(`Seat ${seat.seatPosition} removed from bench ${bench.benchNumber}`);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(safeHallError(err));
    } finally {
      setBusy(null);
    }
  }

  if (loading && !halls) return <PageLoader label="Loading halls..." />;

  if (error && !halls) {
    return (
      <div className="panel">
        <h1>Hall Management</h1>
        <Alert variant="danger">{error}</Alert>
        <div className="form-actions">
          <button type="button" className="button button--ghost" onClick={retry}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!halls) return null;

  return (
    <div className="panel">
      <h1>Hall Management</h1>
      <p className="muted">
        Manage halls and benches. Capacity is always derived from active seats —
        benches are a grouping layer and never change the solver input.
      </p>

      <div className="form-actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => setShowCreateHall((v) => !v)}
        >
          {showCreateHall ? "Cancel" : "Add hall"}
        </button>
      </div>

      {showCreateHall && (
        <form
          className="bench-grid"
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreateHall();
          }}
        >
          <label className="field">
            <span>Hall number</span>
            <input
              type="text"
              value={hallForm.hallNumber}
              onChange={(event) => setHallForm((f) => ({ ...f, hallNumber: event.target.value }))}
              placeholder="LH10"
            />
          </label>
          <label className="field">
            <span>Name</span>
            <input
              type="text"
              value={hallForm.name}
              onChange={(event) => setHallForm((f) => ({ ...f, name: event.target.value }))}
              placeholder="Lecture Hall 10"
            />
          </label>
          <label className="field">
            <span>Building</span>
            <input
              type="text"
              value={hallForm.building}
              onChange={(event) => setHallForm((f) => ({ ...f, building: event.target.value }))}
              placeholder="North Block"
            />
          </label>
          <label className="field">
            <span>Rows</span>
            <input
              type="number"
              min={1}
              value={hallForm.rows}
              onChange={(event) => setHallForm((f) => ({ ...f, rows: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>Columns</span>
            <input
              type="number"
              min={1}
              value={hallForm.columns}
              onChange={(event) => setHallForm((f) => ({ ...f, columns: event.target.value }))}
            />
          </label>
          <div className="form-actions">
            <button type="submit" className="button button--primary" disabled={busy === "create-hall"}>
              Create hall
            </button>
          </div>
        </form>
      )}

      {formError && <Alert variant="danger">{formError}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}
      {error && <Alert variant="danger">{error}</Alert>}

      {halls.length === 0 ? (
        <Alert variant="info">No halls exist yet. Add a hall to begin managing benches.</Alert>
      ) : (
        halls.map((hall) => (
          <section key={hall.id} className="panel panel--subsection">
            <div className="hall-heading">
              <div>
                <h2>
                  {hall.hallNumber} — {hall.name}
                </h2>
                <p className="muted">
                  {hall.building ?? "No building"} · {hall.rows}×{hall.columns} grid ·{" "}
                  {hall.activeSeatCount}/{hall.totalSeatCount} active seats
                </p>
              </div>
              <div className="form-actions">
                <span className={`status-badge status-badge--${hall.isActive ? "active" : "inactive"}`}>
                  {hall.isActive ? "ACTIVE" : "INACTIVE"}
                </span>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => void handleToggleHall(hall)}
                >
                  {hall.isActive ? "Deactivate" : "Activate"}
                </button>
              </div>
            </div>

            {hall.benches.length === 0 ? (
              <Alert variant="info">No benches in this hall yet.</Alert>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Bench</th>
                      <th>Capacity</th>
                      <th>Seats</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hall.benches.map((bench) => (
                      <tr key={bench.id}>
                        <td className="mono">{bench.benchNumber}</td>
                        <td>{bench.capacity}</td>
                        <td>
                          {bench.seats.length === 0 ? (
                            <span className="muted">—</span>
                          ) : (
                            bench.seats
                              .map((s) => s.seatPosition)
                              .join(", ")
                          )}
                        </td>
                        <td>
                          <span
                            className={`status-badge status-badge--${bench.isActive ? "active" : "inactive"}`}
                          >
                            {bench.isActive ? "ACTIVE" : "INACTIVE"}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="button button--ghost"
                            disabled={busy === `toggle-${bench.id}`}
                            onClick={() => void handleToggleBench(bench, hall)}
                          >
                            {bench.isActive ? "Deactivate" : "Activate"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="bench-grid">
              <div className="form-actions">
                <label className="field" style={{ display: "inline-flex", marginBottom: 0 }}>
                  <span>New bench</span>
                  <input
                    type="text"
                    placeholder="B1"
                    value={benchDrafts[hall.id] ?? ""}
                    onChange={(event) =>
                      setBenchDrafts((d) => ({ ...d, [hall.id]: event.target.value }))
                    }
                  />
                </label>
                <button
                  type="button"
                  className="button button--primary"
                  disabled={busy === `bench-${hall.id}`}
                  onClick={() => void handleCreateBench(hall)}
                >
                  Add bench
                </button>
              </div>

              {hall.benches.map((bench) => {
                const assignable = hall.unassignedSeats.filter((s) => s.isActive);
                return (
                  <div key={bench.id} className="bench-assignment">
                    <div className="form-actions">
                      <span className="mono">Bench {bench.benchNumber}</span>
                      <label className="field" style={{ display: "inline-flex", marginBottom: 0 }}>
                        <span className="visually-hidden">Seat to assign to bench {bench.benchNumber}</span>
                        <select
                          aria-label={`Seat to assign to bench ${bench.benchNumber}`}
                          value={seatPick[bench.id] ?? ""}
                          onChange={(event) =>
                            setSeatPick((p) => ({ ...p, [bench.id]: event.target.value }))
                          }
                        >
                          <option value="">Select seat…</option>
                          {assignable.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.seatPosition}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="button button--ghost"
                        disabled={!seatPick[bench.id] || busy === `assign-${bench.id}`}
                        onClick={() => void handleAssignSeat(bench)}
                      >
                        Assign seat
                      </button>
                    </div>
                    {bench.seats.length > 0 && (
                      <ul className="seat-chip-list">
                        {bench.seats.map((seat) => (
                          <li key={seat.id} className="seat-chip">
                            <span className="mono">
                              {seat.seatPosition}
                              {!seat.isActive ? " (inactive)" : ""}
                            </span>
                            <button
                              type="button"
                              className="button button--ghost button--small"
                              disabled={busy === `remove-${bench.id}-${seat.id}`}
                              onClick={() => void handleRemoveSeat(bench, seat)}
                              aria-label={`Remove ${seat.seatPosition} from bench ${bench.benchNumber}`}
                            >
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {assignable.length === 0 && (
                      <p className="muted">No unassigned active seats available.</p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function safeHallError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "UNAUTHORIZED":
        return "Your session has expired. Please log in again.";
      case "FORBIDDEN":
        return "You do not have permission to manage halls and benches.";
      case "HALL_NOT_FOUND":
        return "The hall no longer exists. Reload to refresh.";
      case "BENCH_NOT_FOUND":
        return "The bench no longer exists. Reload to refresh.";
      case "BENCH_SEAT_HALL_MISMATCH":
        return "Seats can only be assigned to benches in the same hall.";
      case "BENCH_SEAT_NOT_ASSIGNED":
        return "That seat is not assigned to this bench.";
      case "INVALID_INPUT":
        return "Invalid input. Please check the values and try again.";
      case "NETWORK_ERROR":
        return "Unable to reach the server. Please try again.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return "Something went wrong. Please try again.";
}