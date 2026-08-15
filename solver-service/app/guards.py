"""Pre-dispatch composition & capacity guard (§26, §27, §28, §39).

Computes domain composition metrics and classifies the domain. Risk thresholds
are CONFIGURABLE scheduling/risk signals, NOT mathematical infeasibility proofs
(owner correction, 2026-08-15). Only ``candidateCount > seatCount`` is a true
capacity error: the domain cannot physically seat every candidate.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional

from .models import Candidate

Classification = Literal["BALANCED", "IMBALANCE_RISK", "INSUFFICIENT_CAPACITY"]

ERR_INSUFFICIENT_DOMAIN_CAPACITY = "ERR_INSUFFICIENT_DOMAIN_CAPACITY"
ERR_DOMAIN_COMPOSITION_IMBALANCE = "ERR_DOMAIN_COMPOSITION_IMBALANCE"


@dataclass
class CompositionLimits:
    largestDepartmentRatio: float = 0.60
    largestYearRatio: float = 0.70
    largestCohortRatio: float = 0.50
    maxEmptySeatRatio: float = 0.80


@dataclass
class CompositionReport:
    candidate_count: int
    seat_count: int
    empty_seat_count: int
    occupancy_ratio: float
    empty_seat_ratio: float
    department_counts: dict[str, int] = field(default_factory=dict)
    year_counts: dict[str, int] = field(default_factory=dict)
    cohort_counts: dict[str, int] = field(default_factory=dict)
    largest_department_count: int = 0
    largest_year_count: int = 0
    largest_cohort_count: int = 0
    largest_department_ratio: float = 0.0
    largest_year_ratio: float = 0.0
    largest_cohort_ratio: float = 0.0
    classification: Classification = "BALANCED"
    risk_violations: list[str] = field(default_factory=list)
    error_code: Optional[str] = None


def compute_composition_report(
    candidates: list[Candidate],
    seat_count: int,
    limits: Optional[CompositionLimits] = None,
) -> CompositionReport:
    limits = limits or CompositionLimits()

    candidate_count = len(candidates)
    if candidate_count > seat_count:
        return CompositionReport(
            candidate_count=candidate_count,
            seat_count=seat_count,
            empty_seat_count=0,
            occupancy_ratio=1.0,
            empty_seat_ratio=0.0,
            classification="INSUFFICIENT_CAPACITY",
            risk_violations=[
                f"{ERR_INSUFFICIENT_DOMAIN_CAPACITY}: candidates={candidate_count} > seats={seat_count}"
            ],
            error_code=ERR_INSUFFICIENT_DOMAIN_CAPACITY,
        )

    department_counts: dict[str, int] = {}
    year_counts: dict[str, int] = {}
    cohort_counts: dict[str, int] = {}
    for c in candidates:
        department_counts[c.department] = department_counts.get(c.department, 0) + 1
        year = c.year if c.year is not None else "<none>"
        year_counts[year] = year_counts.get(year, 0) + 1
        cohort = (c.department, year)
        cohort_counts[cohort] = cohort_counts.get(cohort, 0) + 1

    largest_department_count = max(department_counts.values(), default=0)
    largest_year_count = max(year_counts.values(), default=0)
    largest_cohort_count = max(cohort_counts.values(), default=0)

    largest_department_ratio = largest_department_count / candidate_count if candidate_count else 0.0
    largest_year_ratio = largest_year_count / candidate_count if candidate_count else 0.0
    largest_cohort_ratio = largest_cohort_count / candidate_count if candidate_count else 0.0

    empty_seat_count = seat_count - candidate_count
    empty_seat_ratio = empty_seat_count / seat_count if seat_count else 0.0
    occupancy_ratio = candidate_count / seat_count if seat_count else 0.0

    risk_violations: list[str] = []
    if largest_department_ratio > limits.largestDepartmentRatio:
        risk_violations.append(
            f"largestDepartmentRatio={largest_department_ratio:.2f} > limit {limits.largestDepartmentRatio}"
        )
    # year/cohort risk is only meaningful when multiple buckets exist; a single
    # year (or absent year data) is structure, not an imbalance
    if len(year_counts) >= 2 and largest_year_ratio > limits.largestYearRatio:
        risk_violations.append(
            f"largestYearRatio={largest_year_ratio:.2f} > limit {limits.largestYearRatio}"
        )
    if len(cohort_counts) >= 2 and largest_cohort_ratio > limits.largestCohortRatio:
        risk_violations.append(
            f"largestCohortRatio={largest_cohort_ratio:.2f} > limit {limits.largestCohortRatio}"
        )
    if empty_seat_ratio > limits.maxEmptySeatRatio:
        risk_violations.append(
            f"emptySeatRatio={empty_seat_ratio:.2f} > limit {limits.maxEmptySeatRatio}"
        )

    classification: Classification = "BALANCED" if not risk_violations else "IMBALANCE_RISK"

    return CompositionReport(
        candidate_count=candidate_count,
        seat_count=seat_count,
        empty_seat_count=empty_seat_count,
        occupancy_ratio=round(occupancy_ratio, 4),
        empty_seat_ratio=round(empty_seat_ratio, 4),
        department_counts=department_counts,
        year_counts=year_counts,
        cohort_counts={f"{d}/{y}": n for (d, y), n in sorted(cohort_counts.items())},
        largest_department_count=largest_department_count,
        largest_year_count=largest_year_count,
        largest_cohort_count=largest_cohort_count,
        largest_department_ratio=round(largest_department_ratio, 4),
        largest_year_ratio=round(largest_year_ratio, 4),
        largest_cohort_ratio=round(largest_cohort_ratio, 4),
        classification=classification,
        risk_violations=risk_violations,
    )