/**
 * Guard-parity harness: identical fixtures through the TypeScript
 * computeCompositionGuard and the FROZEN Python guards.compute_composition_report.
 * Asserts equal classification, error code, and risk-violation count.
 *
 * Usage: npx tsx scripts/guard-parity.ts
 * Exit 0 = parity, non-zero = mismatch (with evidence printed).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeCompositionGuard } from "../src/phase4/partition";
import { GUARD_ERR_CODES } from "../src/phase4/types";
import type { DomainCandidate } from "../src/phase4/types";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

interface Fixture {
  name: string;
  seatCount: number;
  candidates: [string, string | null][];
}

const FIXTURES: Fixture[] = [
  {
    name: "balanced-equal-mix",
    seatCount: 30,
    candidates: ([
      ["CSE", "2026"],
      ["CSE", "2026"],
      ["ECE", "2026"],
      ["ECE", "2026"],
      ["MECH", "2027"],
      ["MECH", "2027"],
    ].flatMap((c) => Array.from({ length: 5 }, () => c)) as [string, string][]),
  },
  {
    name: "imbalance-department",
    seatCount: 20,
    candidates: [
      ...Array.from({ length: 18 }, () => ["CSE", "2026"] as [string, string]),
      ...Array.from({ length: 2 }, () => ["ECE", "2026"] as [string, string]),
    ],
  },
  {
    name: "imbalance-year",
    seatCount: 20,
    candidates: [
      ...Array.from({ length: 8 }, () => ["CSE", "2026"] as [string, string]),
      ...Array.from({ length: 8 }, () => ["ECE", "2026"] as [string, string]),
      ...Array.from({ length: 4 }, () => ["CSE", "2027"] as [string, string]),
    ],
  },
  {
    name: "imbalance-cohort",
    seatCount: 20,
    candidates: [
      ...Array.from({ length: 12 }, () => ["CSE", "2026"] as [string, string]),
      ...Array.from({ length: 4 }, () => ["ECE", "2026"] as [string, string]),
      ...Array.from({ length: 4 }, () => ["MECH", "2027"] as [string, string]),
    ],
  },
  {
    name: "imbalance-empty-seat",
    seatCount: 25,
    candidates: [...Array.from({ length: 4 }, () => ["CSE", "2026"] as [string, string])],
  },
  {
    name: "insufficient-capacity",
    seatCount: 25,
    candidates: [...Array.from({ length: 26 }, () => ["CSE", "2026"] as [string, string])],
  },
  {
    name: "boundary-department-at-limit",
    seatCount: 20,
    candidates: [
      ...Array.from({ length: 12 }, () => ["CSE", "2026"] as [string, string]),
      ...Array.from({ length: 8 }, () => ["ECE", "2026"] as [string, string]),
    ],
  },
  {
    name: "boundary-empty-at-limit",
    seatCount: 50,
    candidates: [
      ...Array.from({ length: 3 }, () => ["CSE", "2026"] as [string, string]),
      ...Array.from({ length: 3 }, () => ["ECE", "2026"] as [string, string]),
      ...Array.from({ length: 3 }, () => ["MECH", "2026"] as [string, string]),
      ...Array.from({ length: 1 }, () => ["BIO", "2026"] as [string, string]),
    ],
  },
  {
    name: "boundary-year-at-limit",
    seatCount: 10,
    candidates: [
      ...Array.from({ length: 4 }, () => ["CSE", "2026"] as [string, string]),
      ...Array.from({ length: 3 }, () => ["ECE", "2026"] as [string, string]),
      ...Array.from({ length: 3 }, () => ["MECH", "2027"] as [string, string]),
    ],
  },
  {
    name: "single-year-no-year-violation",
    seatCount: 20,
    candidates: [
      ...Array.from({ length: 18 }, () => ["CSE", "2026"] as [string, string]),
      ...Array.from({ length: 2 }, () => ["ECE", "2026"] as [string, string]),
    ],
  },
];

function toCandidate([department, year]: [string, string | null]): DomainCandidate {
  return {
    id: `${department}-${year ?? "na"}`,
    registerNumber: "R0001",
    studentName: "Student",
    department,
    class: "CSE-A",
    gender: "MALE",
    subjectCode: "CS8501",
    subjectName: "Subject",
    year: year ?? undefined,
  };
}

interface PythonResult {
  name: string;
  classification: string;
  errorCode: string | null;
  riskViolationCount: number;
}

function runPython(): PythonResult[] {
  const python = path.join(root, "solver-service", ".venv", "Scripts", "python.exe");
  const fixtures = FIXTURES.map((f) => ({
    name: f.name,
    seatCount: f.seatCount,
    candidates: f.candidates,
  }));
  const result = spawnSync(
    python,
    [path.join(root, "scripts", "guard-parity-python.py")],
    { cwd: path.join(root, "solver-service"), input: JSON.stringify(fixtures), encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`python guard parity failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout) as PythonResult[];
}

function main(): number {
  const pythonResults = runPython();
  let failures = 0;
  console.log("fixture\tTS\tPython\terrorCode(TS)\terrorCode(Py)\triskCount(TS/Py)\tOK");
  for (const fixture of FIXTURES) {
    const candidates = fixture.candidates.map(toCandidate);
    const ts = computeCompositionGuard(candidates, fixture.seatCount);
    const py = pythonResults.find((r) => r.name === fixture.name);
    if (!py) throw new Error(`no python result for ${fixture.name}`);
    const tsErrorCode =
      ts.classification === "INSUFFICIENT_CAPACITY" ? GUARD_ERR_CODES.INSUFFICIENT_CAPACITY : null;
    const ok =
      ts.classification === py.classification &&
      tsErrorCode === py.errorCode &&
      ts.riskViolations.length === py.riskViolationCount;
    if (!ok) failures += 1;
    console.log(
      `${fixture.name}\t${ts.classification}\t${py.classification}\t${tsErrorCode ?? "-"}\t${py.errorCode ?? "-"}\t${ts.riskViolations.length}/${py.riskViolationCount}\t${ok ? "PASS" : "FAIL"}`,
    );
  }
  if (failures > 0) {
    console.error(`\nGUARD PARITY FAILED: ${failures}/${FIXTURES.length} fixtures differ.`);
    return 1;
  }
  console.log(`\nGuard parity OK (${FIXTURES.length}/${FIXTURES.length} fixtures identical).`);
  return 0;
}

process.exit(main());