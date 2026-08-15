"""Pydantic schemas for the solver request (§4) and response (§5) contracts."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Gender = Literal["MALE", "FEMALE", "OTHER"]
ModelKind = Literal["dense", "structured"]
ScopeKind = Literal["class", "department"]

Status = Literal["OPTIMAL", "FEASIBLE", "INFEASIBLE", "ERROR"]


class Candidate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(min_length=1)
    registerNumber: str = ""
    studentName: str = ""
    department: str = Field(min_length=1)
    class_: str = Field(alias="class", min_length=1)
    gender: Gender = "OTHER"
    subjectCode: str = ""
    subjectName: str = ""
    year: Optional[str] = None


class Seat(BaseModel):
    id: str = Field(min_length=1)
    seatPosition: str = ""
    row: str = Field(min_length=1)
    column: int = Field(ge=1)


class Hall(BaseModel):
    id: str = Field(min_length=1)
    hallNumber: str = Field(min_length=1)
    name: str = ""
    building: Optional[str] = None
    rows: int = Field(ge=1)
    columns: int = Field(ge=1)
    capacity: int = Field(ge=0)
    seats: list[Seat]

    @field_validator("seats")
    @classmethod
    def _seats_within_grid(cls, v: list[Seat], info) -> list[Seat]:
        rows = info.data.get("rows")
        columns = info.data.get("columns")
        if rows is None or columns is None:
            return v
        for seat in v:
            row_index = ord(seat.row.upper()) - ord("A")
            if not (0 <= row_index < rows):
                raise ValueError(f"seat {seat.id!r}: row {seat.row!r} outside {rows}-row grid")
            if not (1 <= seat.column <= columns):
                raise ValueError(f"seat {seat.id!r}: column {seat.column} outside {columns}-column grid")
        return v


PolicyMode = Literal["DEPARTMENT_ONLY", "STRICT_DEPT_OR_YEAR", "COHORT"]
AdjacencyMode = Literal["eight", "cardinal"]


class SolverConfig(BaseModel):
    model: ModelKind = "structured"
    hardRuleScope: ScopeKind = "class"
    randomSeed: int = Field(default=42, ge=0)
    numSearchWorkers: Optional[int] = Field(default=None, ge=1)
    policyMode: PolicyMode = "DEPARTMENT_ONLY"
    adjacency: AdjacencyMode = "eight"
    compositionAction: Literal["warn", "reject"] = "warn"


class SolveRequest(BaseModel):
    requestId: str = Field(min_length=1)
    examId: str = Field(min_length=1)
    candidates: list[Candidate]
    halls: list[Hall]
    timeLimitSeconds: int = Field(default=60, ge=1)
    solverConfig: SolverConfig = Field(default_factory=SolverConfig)
    candidateCount: Optional[int] = None
    availableSeatCount: Optional[int] = None

    @model_validator(mode="after")
    def _structural_checks(self) -> "SolveRequest":
        if not self.halls:
            raise ValueError("halls must not be empty")

        total_seats = sum(len(h.seats) for h in self.halls)
        if self.candidateCount is not None and self.candidateCount != len(self.candidates):
            raise ValueError("candidateCount != candidates.length")
        if self.availableSeatCount is not None and self.availableSeatCount != total_seats:
            raise ValueError("availableSeatCount != active seat count")

        candidate_ids = [c.id for c in self.candidates]
        if len(set(candidate_ids)) != len(candidate_ids):
            raise ValueError("duplicate candidate id")
        seat_ids = [s.id for h in self.halls for s in h.seats]
        if len(set(seat_ids)) != len(seat_ids):
            raise ValueError("duplicate seat id")
        return self


class Assignment(BaseModel):
    candidateId: str
    hallId: str
    hallSeatId: str


class SolveResponse(BaseModel):
    requestId: str
    status: Status
    assignments: list[Assignment] = []
    solverDurationMs: int = 0
    candidateCount: int = 0
    assignedCount: int = 0
    unassignedCount: int = 0
    objectiveValue: Optional[int] = None
    infeasibilityReason: Optional[str] = None
    errorCode: Optional[str] = None
    errorMessage: Optional[str] = None