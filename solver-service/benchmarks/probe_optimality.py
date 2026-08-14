"""Probe: time to prove OPTIMAL for a given dataset size."""
from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import oracle, solver  # noqa: E402
from app.config import Settings  # noqa: E402
from benchmarks.dataset import build_500_dataset  # noqa: E402


def run_approach(name: str, kind: str, request, time_limit: int, workers: int) -> None:
    settings = Settings(internal_token="probe", num_search_workers=workers)
    req = request.model_copy(update={"timeLimitSeconds": time_limit})
    t0 = time.perf_counter()
    if kind == "A":
        status, _assignments, objective = oracle.solve_dense(req, settings)
    else:
        resp = solver.solve_request(req, settings)
        status, objective = resp.status, resp.objectiveValue
    elapsed = time.perf_counter() - t0
    print(f"[{name}] timeLimit={time_limit}s workers={workers} status={status} objective={objective} wallMs={int(round(elapsed * 1000))}", flush=True)


if __name__ == "__main__":
    base = build_500_dataset()
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 600
    workers = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    kind = sys.argv[3] if len(sys.argv) > 3 else "both"
    if kind in ("A", "both"):
        run_approach("A-dense", "A", base, limit, workers)
    if kind in ("C", "both"):
        run_approach("C-structured", "C", base, limit, workers)