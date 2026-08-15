"""FastAPI app — stateless internal solver service.

- GET /health            (open liveness probe, no solver data exposed)
- POST /solve            (X-Internal-Token via shared dependency, pydantic 422, payload 413, timeout per §16)
- POST /solve-domain     (X-Internal-Token via shared dependency, pydantic 422, payload 413, timeout per §16)

Every route that performs or exposes solver work is guarded by the single shared
require_internal_token dependency. The service never connects to a database and
holds no credentials. Trust boundary is fail-closed (see config.py).
"""
from __future__ import annotations

import logging

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from . import seatlabel, solver
from .config import get_settings
from .models import SolveRequest

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("solver")

settings = get_settings()

app = FastAPI(title="AR-SEAT CP-SAT Solver", docs_url=None, redoc_url=None, openapi_url=None)


def require_internal_token(request: Request) -> None:
    """Reject any request without a valid configured X-Internal-Token (401)."""
    if not settings.verify_token(request.headers.get("X-Internal-Token")):
        raise HTTPException(status_code=401, detail="unauthorized")


@app.middleware("http")
async def _limit_body_size(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit():
        if int(content_length) > settings.max_request_bytes:
            return JSONResponse({"detail": "payload too large"}, status_code=413)
    return await call_next(request)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/solve", dependencies=[Depends(require_internal_token)])
async def solve(req: SolveRequest) -> dict:
    total_seats = sum(len(h.seats) for h in req.halls)
    if len(req.candidates) > total_seats:
        raise HTTPException(status_code=422, detail="candidateCount > availableSeatCount")
    if req.timeLimitSeconds > settings.max_time_limit_seconds:
        raise HTTPException(status_code=422, detail="timeLimitSeconds exceeds MAX_TIME_LIMIT_SECONDS")

    resp = solver.solve_request(req, settings)
    logger.info(
        "requestId=%s status=%s candidateCount=%d assignedCount=%d objective=%s durationMs=%d",
        req.requestId,
        resp.status,
        resp.candidateCount,
        resp.assignedCount,
        resp.objectiveValue,
        resp.solverDurationMs,
    )
    return resp.model_dump()


@app.post("/solve-domain", dependencies=[Depends(require_internal_token)])
def solve_domain(req: SolveRequest) -> dict:
    """Phase 4 orchestration endpoint — solve ONE physical domain per request.

    Calls the frozen seat-label engine (seatlabel.solve_domain), which requires
    the request to span exactly one connected component of the physical seat
    graph (splitting components is the Node orchestrator's job, §11.1). No
    solver formulation/partition/guard logic is touched here.

    SYNC (def, not async): FastAPI runs synchronous endpoints in a threadpool,
    so the blocking CP-SAT solve no longer occupies the asyncio event loop and
    concurrent /solve-domain requests can execute in parallel. Execution-model
    change only; the frozen engine is unchanged.
    """
    total_seats = sum(len(h.seats) for h in req.halls)
    if len(req.candidates) > total_seats:
        raise HTTPException(status_code=422, detail="candidateCount > availableSeatCount")
    if req.timeLimitSeconds > settings.max_time_limit_seconds:
        raise HTTPException(status_code=422, detail="timeLimitSeconds exceeds MAX_TIME_LIMIT_SECONDS")

    resp = seatlabel.solve_domain(req, settings)
    logger.info(
        "requestId=%s domainStatus=%s candidateCount=%d assignedCount=%d objective=%s durationMs=%d",
        req.requestId,
        resp.status,
        resp.candidateCount,
        resp.assignedCount,
        resp.objectiveValue,
        resp.solverDurationMs,
    )
    return resp.model_dump()
