/**
 * Local development launcher — `npm run dev:all`.
 *
 * Starts the full local stack by REUSING the Phase 14 components — it does NOT
 * re-implement anything:
 *   - disposable local Docker postgres (non-destructive: start existing or
 *     create once; never `rm -f`)
 *   - `prisma migrate deploy` (idempotent)
 *   - E2E seed, ONLY when the database is empty (provides e2e-admin/e2e-staff)
 *   - the frozen solver (solver-service venv uvicorn)
 *   - the real Phase 14 backend bootstrap (scripts/e2e/server.mjs)
 *   - the existing frontend `vite` dev server
 *
 * Ctrl+C / unexpected child exit tears every child down via `taskkill /T /F`
 * (Windows) to avoid orphaned node/python processes.
 */
import { spawn, spawnSync, execSync } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const DB_CONTAINER = "ar-seat-e2e-db";
const DB_USER = "arseat";
const DB_PASSWORD = process.env.E2E_DB_PASSWORD ?? "arseat-e2e-secret-2026";
const DB_NAME = "exam_seating_e2e_test";
const DB_PORT = 55432;
const DB_URL = `postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${DB_PORT}/${DB_NAME}`;
const SOLVER_TOKEN = "e2e-internal-token";
const SOLVER_PORT = 8000;
const BACKEND_PORT = 8787;
const FRONTEND_PORT = 5173;
const TEMP_DIR = process.env.E2E_TEMP_DIR ?? path.join(os.tmpdir(), "arseat-e2e");
const SEED_STATE = `${TEMP_DIR}\\seed-state.json`;

function step(message) {
  console.log(`[dev-all] ${message}`);
}

function sh(command, options = {}) {
  return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...options });
}

function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const hosts = ["127.0.0.1", "::1"];
  return new Promise((resolve, reject) => {
    function tryHost(index) {
      const socket = net.connect({ host: hosts[index], port });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (index + 1 < hosts.length) {
          tryHost(index + 1);
        } else if (Date.now() > deadline) {
          reject(new Error(`port ${port} not reachable within ${timeoutMs}ms`));
        } else {
          setTimeout(() => tryHost(0), 500);
        }
      });
    }
    tryHost(0);
  });
}

function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function tryFetch() {
      fetch(url)
        .then((res) => (res.ok ? resolve() : setTimeout(tryFetch, 500)))
        .catch(() => {
          if (Date.now() > deadline) reject(new Error(`GET ${url} not ok within ${timeoutMs}ms`));
          else setTimeout(tryFetch, 500);
        });
    }
    tryFetch();
  });
}

function scrubEnv() {
  const env = { ...process.env };
  for (const key of [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_STORAGE_BUCKET",
    "DATABASE_URL",
    "DIRECT_URL",
    "TEST_DATABASE_URL",
    "TEST_DIRECT_URL",
    "SOLVER_INTERNAL_TOKEN",
  ]) {
    delete env[key];
  }
  return env;
}

const children = [];
let shuttingDown = false;

function startChild(command, args, cwd, env, label) {
  const child = spawn(command, args, {
    cwd,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  const pump = (stream) => {
    stream.setEncoding("utf8");
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        process.stdout.write(`[${label}] ${buf.slice(0, idx)}\n`);
        buf = buf.slice(idx + 1);
      }
    });
    stream.on("end", () => {
      if (buf.trim()) process.stdout.write(`[${label}] ${buf}\n`);
    });
  };
  pump(child.stdout);
  pump(child.stderr);
  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(`[dev-all] ${label} exited unexpectedly (code=${code} signal=${signal})`);
      shutdown(1);
    }
  });
  child.on("error", (error) => {
    if (!shuttingDown) {
      console.error(`[dev-all] failed to spawn ${label}: ${error.message}`);
      shutdown(1);
    }
  });
  step(`started ${label} (${command} ${args.join(" ")}) pid=${child.pid}`);
  return child;
}

function killTree(child) {
  try {
    execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: "ignore" });
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  step(`stopping ${children.length} child process(es)`);
  for (const child of children) killTree(child);
  step("stopped. the local postgres container (ar-seat-e2e-db) was left running on purpose.");
  process.exit(exitCode);
}

function isPortListening(port) {
  try {
    const socket = net.connect({ host: "127.0.0.1", port });
    let ok = false;
    return new Promise((resolve) => {
      socket.once("connect", () => {
        ok = true;
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
      setTimeout(() => resolve(ok), 1500);
    });
  } catch {
    return Promise.resolve(false);
  }
}

async function ensureDatabase() {
  step("ensuring local postgres container");
  try {
    sh(`docker start ${DB_CONTAINER}`);
  } catch {
    sh(
      `docker run -d --name ${DB_CONTAINER} -e POSTGRES_USER=${DB_USER} ` +
        `-e POSTGRES_PASSWORD=${DB_PASSWORD} -e POSTGRES_DB=${DB_NAME} ` +
        `-p 127.0.0.1:${DB_PORT}:5432 postgres:16`,
    );
  }

  step("waiting for postgres readiness");
  await waitForPort(DB_PORT, 120_000);
  for (let i = 0; i < 30; i++) {
    try {
      execSync(`docker exec ${DB_CONTAINER} pg_isready -U ${DB_USER} -d ${DB_NAME}`, { stdio: "ignore" });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (i === 29) throw new Error("postgres did not become ready");
    }
  }

  const u = new URL(DB_URL);
  const hostOk = u.hostname === "127.0.0.1" || u.hostname === "localhost";
  const pathOk = u.pathname.toLowerCase().includes("test");
  step(
    `safety gate: host=${u.hostname} path=${u.pathname} ` +
      `host_is_local=${hostOk} path_contains_test=${pathOk}`,
  );
  if (!hostOk || !pathOk) {
    throw new Error("FAIL_CLOSED: refusing to run against a non-test target");
  }

  const dbEnv = { ...process.env, DATABASE_URL: DB_URL, DIRECT_URL: DB_URL };

  step("applying pending migrations (prisma migrate deploy)");
  const migrate = spawnSync(
    process.execPath,
    [path.join("node_modules", "prisma", "build", "index.js"), "migrate", "deploy"],
    { cwd: REPO, env: dbEnv, stdio: "inherit", windowsHide: true },
  );
  if (migrate.status !== 0) throw new Error("prisma migrate deploy failed");

  const count = spawnSync(
    process.execPath,
    ["-e", `
      const { Client } = require("pg");
      const c = new Client({ connectionString: process.env.DATABASE_URL });
      c.connect()
        .then(() => c.query("select count(*)::int as n from users"))
        .then((r) => { console.log("USER_COUNT=" + r.rows[0].n); return c.end(); })
        .catch((e) => { console.error(e.message); process.exit(2); });
    `],
    { cwd: REPO, env: dbEnv, encoding: "utf8", windowsHide: true },
  );
  if (count.status !== 0) throw new Error("could not inspect database user count");
  const userCount = Number((count.stdout.match(/USER_COUNT=(\d+)/) ?? [])[1] ?? -1);
  if (userCount === 0) {
    step("database is empty — seeding (provides e2e-admin / e2e-staff)");
    const seed = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/e2e/seed.mjs"],
      { cwd: REPO, env: { ...dbEnv, E2E_SEED_STATE: SEED_STATE }, stdio: "inherit", windowsHide: true },
    );
    if (seed.status !== 0) throw new Error("seed failed");
  } else {
    step(`database already has data (${userCount} user(s)) — skipping seed`);
  }
}

async function main() {
  for (const [label, port] of [
    ["solver", SOLVER_PORT],
    ["backend", BACKEND_PORT],
    ["frontend", FRONTEND_PORT],
  ]) {
    if (await isPortListening(port)) {
      throw new Error(`port ${port} is already in use — stop the other ${label} process first`);
    }
  }

  await ensureDatabase();

  step("starting solver service");
  startChild(
    path.join(REPO, "solver-service", ".venv", "Scripts", "python.exe"),
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(SOLVER_PORT)],
    path.join(REPO, "solver-service"),
    { ...process.env, SOLVER_INTERNAL_TOKEN: SOLVER_TOKEN },
    "solver",
  );
  step(`waiting for solver /health on port ${SOLVER_PORT}`);
  await waitForHttp(`http://127.0.0.1:${SOLVER_PORT}/health`, 90_000);

  step("starting backend server");
  const backendEnv = scrubEnv();
  backendEnv.DATABASE_URL = DB_URL;
  backendEnv.DIRECT_URL = DB_URL;
  backendEnv.SOLVER_BASE_URL = `http://127.0.0.1:${SOLVER_PORT}`;
  backendEnv.SOLVER_INTERNAL_TOKEN = SOLVER_TOKEN;
  backendEnv.PORT = String(BACKEND_PORT);
  startChild(
    process.execPath,
    ["--import", "tsx", "scripts/e2e/server.mjs"],
    REPO,
    backendEnv,
    "backend",
  );
  step(`waiting for backend port ${BACKEND_PORT}`);
  await waitForPort(BACKEND_PORT, 60_000);

  step("starting frontend dev server");
  startChild(
    process.execPath,
    ["node_modules/vite/bin/vite.js"],
    path.join(REPO, "frontend"),
    { ...process.env, VITE_API_TARGET: `http://127.0.0.1:${BACKEND_PORT}` },
    "frontend",
  );
  step(`waiting for frontend port ${FRONTEND_PORT}`);
  await waitForPort(FRONTEND_PORT, 60_000);

  step("all services up");
  console.log("");
  console.log("  backend  -> http://127.0.0.1:8787   (real Phase 4 API + solver dispatch)");
  console.log("  frontend -> http://localhost:5173   (vite dev server, proxies /auth + /exam-seating)");
  console.log("  solver   -> http://127.0.0.1:8000   (frozen CP-SAT service)");
  console.log("  db       -> local docker postgres:16 (ar-seat-e2e-db)");
  console.log("  login    -> e2e-admin / e2e-password-1  (ADMIN), e2e-staff / e2e-password-1 (STAFF)");
  console.log("");
  console.log("Press Ctrl+C to stop everything.");
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("SIGBREAK", () => shutdown(0));

main()
  .catch((error) => {
    console.error("[dev-all] FATAL", error);
    shutdown(1);
  });