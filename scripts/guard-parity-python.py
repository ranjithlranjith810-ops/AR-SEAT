"""Guard parity helper: computes the frozen Python classification for fixtures.

Reads a JSON array of fixtures from stdin:
  [{ "name": str, "seatCount": int, "candidates": [["CSE", "2026"], ...] }]
Writes a JSON array of results to stdout:
  [{ "name": str, "classification": str, "errorCode": str|null,
     "riskViolationCount": int }]
"""
import json
import sys

sys.path.insert(0, ".")

from app.guards import (  # noqa: E402
    ERR_INSUFFICIENT_DOMAIN_CAPACITY,
    compute_composition_report,
)
from app.models import Candidate  # noqa: E402


def build_candidate(department: str, year) -> Candidate:
    return Candidate(
        id=f"{department}-{year or 'na'}",
        registerNumber="R0001",
        studentName="Student",
        department=department,
        class_="CSE-A",
        subjectCode="CS8501",
        subjectName="Subject",
        year=year,
    )


def main() -> None:
    fixtures = json.load(sys.stdin)
    results = []
    for fixture in fixtures:
        candidates = [
            build_candidate(dept, year) for dept, year in fixture["candidates"]
        ]
        report = compute_composition_report(
            candidates, seat_count=fixture["seatCount"]
        )
        results.append(
            {
                "name": fixture["name"],
                "classification": report.classification,
                "errorCode": report.error_code,
                "riskViolationCount": len(report.risk_violations),
            }
        )
    json.dump(results, sys.stdout)


if __name__ == "__main__":
    main()