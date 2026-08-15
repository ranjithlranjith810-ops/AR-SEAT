"""Composition & capacity guard tests (§39)."""
from app.guards import (
    ERR_INSUFFICIENT_DOMAIN_CAPACITY,
    CompositionLimits,
    compute_composition_report,
)
from app.models import Candidate
from tests.helpers import make_candidate


def _cands(n, depts, years=None):
    out = []
    for i in range(n):
        c = make_candidate(i, "CSE-A", depts[i % len(depts)])
        if years:
            c["year"] = years[i % len(years)]
        out.append(Candidate(**c))
    return out


def test_balanced_single_department():
    report = compute_composition_report(_cands(4, ["CSE", "ECE", "MEC", "CIV"]), seat_count=8)
    assert report.classification == "BALANCED"
    assert report.candidate_count == 4
    assert report.empty_seat_count == 4
    assert report.occupancy_ratio == 0.5


def test_insufficient_capacity():
    report = compute_composition_report(_cands(5, ["CSE"]), seat_count=4)
    assert report.classification == "INSUFFICIENT_CAPACITY"
    assert report.error_code == ERR_INSUFFICIENT_DOMAIN_CAPACITY


def test_imbalance_risk_via_cohort_ratio():
    report = compute_composition_report(
        _cands(10, ["CSE", "ECE"], years=["Y1", "Y2"]),
        seat_count=20,
        limits=CompositionLimits(largestCohortRatio=0.25),
    )
    assert report.classification == "IMBALANCE_RISK"
    assert report.risk_violations


def test_empty_seat_ratio_risk():
    report = compute_composition_report(
        _cands(2, ["CSE"]), seat_count=20, limits=CompositionLimits(maxEmptySeatRatio=0.5)
    )
    assert report.classification == "IMBALANCE_RISK"


def test_risk_thresholds_are_configurable_not_hard_rules():
    tight = compute_composition_report(
        _cands(10, ["CSE", "ECE"], years=["Y1", "Y2"]),
        seat_count=20,
        limits=CompositionLimits(largestCohortRatio=0.25),
    )
    loose = compute_composition_report(
        _cands(10, ["CSE", "ECE"], years=["Y1", "Y2"]),
        seat_count=20,
        limits=CompositionLimits(largestCohortRatio=0.90),
    )
    assert tight.classification == "IMBALANCE_RISK"
    assert loose.classification == "BALANCED"