/**
 * Phase 4 parallel benchmark: real CP-SAT solver service, concurrency 2/4/8.
 *
 * Spawns the frozen uvicorn solver service, runs the SAME multi-domain workload
 * through runGeneration at maxParallelDomains = 2, 4, 8, and records wall-clock,
 * sum of per-domain solve times, domain count, successes/failures, merge validity,
 * peak heap, and CPU delta. Evidence written to docs/evidence/phase4-benchmarks/.
 *
 * Usage: npx tsx scripts/benchmark-parallel.ts [solverPort]
 */
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runGeneration } from "../src/phase4/generation.service";
import { solveDomain } from "../src/phase4/solverClient";
import type { DomainCandidate, DomainHall } from "../src/phase4/types";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const evidenceDir = path.join(root, "docs", "evidence", "phase4-benchmarks");
mkdirSync(evidenceDir, { recursive: true });
const port = Number(process.argv[2] ?? 8000);
const baseUrl = `http://127.0.0.1:${port}`;
process.env.SOLVER_BASE_URL = baseUrl;
process.env.SOLVER_INTERNAL_TOKEN = "dev-internal-token";

const DEPARTMENTS = ["CSE", "ECE", "MECH", "CIVIL"] as const;
const YEARS = ["2026", "2027"] as const;

function makeCandidate(n: number): DomainCandidate {
  const department = DEPARTMENTS[n % DEPARTMENTS.length]!;
  const year = YEARS[Math.floor(n / DEPARTMENTS.length) % YEARS.length]!;
  return {
    id: `bench-${String(n).padStart(4, "0")}`,
    registerNumber: `BENCH${String(n).padStart(4, "0")}`,
    studentName: `Benchmark Student ${n}`,
    department,
    class: `${department}-A`,
    gender: "MALE",
    subjectCode: "CS8501",
    subjectName: "Benchmark Subject",
    year,
  };
}

function makeHall(n: number, rows = 5, columns = 5): DomainHall {
  const hallNumber = `BCH${String(n).padStart(2, "0")}`;
  const seats = Array.from({ length: rows * columns }, (_, i) => ({
    id: `${hallNumber}-seat-${i + 1}`,
    seatPosition: `${String.fromCharCode(65 + Math.floor(i / columns))}${(i % columns) + 1}`,
    row: String.fromCharCode(65 + Math.floor(i / columns)),
    column: (i % columns) + 1,
  }));
  return {
    id: `hall-${n}`,
    hallNumber,
    name: hallNumber,
    building: null,
    rows,
    columns,
    capacity: seats.length,
    seats,
  };
}

function waitForHealth(proc: ChildProcess, url: string, tries = 60): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const timer = setInterval(async () => {
      attempt += 1;
      try {
        const res = await fetch(`${url}/health`);
        if (res.ok) {
          clearInterval(timer);
          resolve();
          return;
        }
      } catch {
        /* not up yet */
      }
      if (attempt >= tries) {
        clearInterval(timer);
        reject(new Error("solver service did not become healthy"));
      }
    }, 500);
  });
}

async function runBenchmark(halls: DomainHall[], candidates: DomainCandidate[]) {
  const out: string[] = [];
  const results: Record<string, unknown> = {};
  for (const workers of [1, 2, 4, 8]) {
    const started = performance.now();
    const peakRss = { value: process.memoryUsage().rss };
    const sampler = setInterval(() => {
      peakRss.value = Math.max(peakRss.value, process.memoryUsage().rss);
    }, 50);
    const cpu0 = process.cpuUsage();
    const result = await runGeneration({
      generationId: `bench:${workers}`,
      examId: "bench-exam",
      candidates,
      halls,
      timeLimitSeconds: 120,
      maxParallelDomains: workers,
      solverConfig: {
        policyMode: "DEPARTMENT_ONLY",
        adjacency: "eight",
        compositionAction: "warn",
        randomSeed: 0,
        numSearchWorkers: null,
      },
      dispatch: { solveDomain },
    });
    clearInterval(sampler);
    const cpu1 = process.cpuUsage(cpu0);
    const wallMs = performance.now() - started;
    const sumSolveMs = result.domains.reduce(
      (sum, d) => sum + (d.result?.solverDurationMs ?? 0),
      0,
    );
    const perDomain = result.domains.map((d) => ({
      domainId: d.domainId,
      state: d.state,
      candidates: d.plan?.candidateCount,
      seats: d.plan?.seatCount,
      status: d.result?.status,
      solveMs: d.result?.solverDurationMs,
      errorMessage: d.errorMessage,
    }));
    const entry = {
      workers,
      state: result.state,
      domainCount: result.domainCount,
      completed: result.completedDomainCount,
      failed: result.failedDomainCount,
      failedDomainIds: result.failedDomainIds,
      blockedDomainIds: result.blockedDomainIds,
      mergeValid: result.merge?.valid,
      assignedCandidateCount: result.merge?.assignedCandidateCount,
      sessionCandidateCount: result.sessionCandidateCount,
      wallClockMs: Math.round(wallMs),
      sumSolveMs,
      partitionMs: Math.round(result.timings.partitionMs),
      dispatchMs: Math.round(result.timings.dispatchMs),
      validationMs: Math.round(result.timings.validationMs),
      mergeMs: Math.round(result.timings.mergeMs),
      peakRssMb: Math.round(peakRss.value / 1024 / 1024),
      cpuUserMs: Math.round(cpu1.user / 1000),
      cpuSystemMs: Math.round(cpu1.system / 1000),
      error: result.error,
      perDomain,
    };
    results[workers] = entry;
    out.push(`--- workers=${workers} ---`);
    out.push(JSON.stringify(entry, null, 2));
  }
  const summary = `# Phase 4 parallel benchmark (real CP-SAT solver)\n` +
    `date: ${new Date().toISOString()}\n` +
    `solver: ${baseUrl}\n` +
    `workload: halls=${halls.length}, seats=${halls.reduce((s, h) => s + h.capacity, 0)}, ` +
    `candidates=${candidates.length}, timeLimitSeconds=120\n\n` +
    out.join("\n") + "\n";
  writeFileSync(path.join(evidenceDir, "phase4-parallel-benchmark.log"), summary);
  appendFileSync(path.join(evidenceDir, "phase4-parallel-benchmark.log"), "\n");
  console.log(summary);
  return results;
}

async function main() {
  // Production-scale workload: 10 independent halls x 100 seats = 1000 seats,
  // 1000 candidates across 4 departments / 2 years. Each hall is an
  // independent physical domain (no cross-hall edges).
  const halls = Array.from({ length: 10 }, (_, i) => makeHall(i + 1, 10, 10));
  const candidates = Array.from({ length: 1000 }, (_, i) => makeCandidate(i));
  const solver = spawn(
    path.join(root, "solver-service", ".venv", "Scripts", "python.exe"),
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(port)],
    { cwd: path.join(root, "solver-service"), stdio: "ignore", shell: false },
  );
  try {
    await waitForHealth(solver, baseUrl);
    await runBenchmark(halls, candidates);
  } finally {
    solver.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});