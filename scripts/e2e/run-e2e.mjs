/**
 * Phase 14 — E2E orchestrator.
 *
 * Fresh local Docker postgres -> migrate -> seed -> solver -> backend -> frontend
 * -> Playwright -> teardown. Fail-closed on the database target before any
 * destructive step. Every service runs with a scrubbed env (no Supabase creds).
 */
import { spawn, spawnSync, execSync } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DB_CONTAINER = "ar-seat-e2e-db";
const DB_USER = "arseat";
const DB_PASSWORD = process.env.E2E_DB_PASSWORD ?? "arseat-e2e-secret-2026";
const DB_NAME = "exam_seating_e2e_test";
const DB_PORT = 55432;
const DB_URL = `postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${DB_PORT}/${DB_NAME}`;
const SOLVER_TOKEN = "e2e-internal-token";
const BACKEND_PORT = 8787;
const SOLVER_PORT = 8000;
const FRONTEND_PORT = 5173;
const TEMP_DIR =
  process.env.E2E_TEMP_DIR ??
  "C:\\Users\\BALAJI\\AppData\\Local\\Temp\\opencode\\arseat-e2e";
const SEED_STATE = `${TEMP_DIR}\\seed-state.json`;

function step(message) {
  console.log(`[e2e-orchestrator] ${message}`);
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

function startProcess(command, args, cwd, env, outFile, errFile) {
  mkdirSync(TEMP_DIR, { recursive: true });
  const outStream = createWriteStream(outFile);
  const errStream = createWriteStream(errFile);
  const child = spawn(command, args, {
    cwd,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(outStream);
  child.stderr.pipe(errStream);
  children.push(child);
  step(`spawned ${command} ${args.join(" ")} pid=${child.pid} cwd=${cwd}`);
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

function teardown() {
  for (const child of children) killTree(child);
}

async function run() {
  step("creating fresh Docker postgres:16 container");
  try {
    sh(`docker rm -f ${DB_CONTAINER}`);
  } catch {
    /* not running yet */
  }
  sh(
    `docker run -d --name ${DB_CONTAINER} -e POSTGRES_USER=${DB_USER} ` +
      `-e POSTGRES_PASSWORD=${DB_PASSWORD} -e POSTGRES_DB=${DB_NAME} ` +
      `-p 127.0.0.1:${DB_PORT}:5432 postgres:16`,
  );

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
    throw new Error("FAIL_CLOSED: refusing E2E against non-test target");
  }

  const dbEnv = { ...process.env, DATABASE_URL: DB_URL, DIRECT_URL: DB_URL };

  step("running prisma migrate deploy");
  sh(`npx prisma migrate deploy`, { env: dbEnv });
  step("running E2E seed");
  sh(`npx tsx scripts/e2e/seed.mjs`, { env: { ...dbEnv, E2E_SEED_STATE: SEED_STATE } });

  step("starting solver service");
  const solver = startProcess(
    `${REPO}\\solver-service\\.venv\\Scripts\\python.exe`,
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(SOLVER_PORT)],
    `${REPO}\\solver-service`,
    { ...process.env, SOLVER_INTERNAL_TOKEN: SOLVER_TOKEN },
    `${TEMP_DIR}\\solver.out.log`,
    `${TEMP_DIR}\\solver.err.log`,
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
  const backend = startProcess(
    process.execPath,
    ["--import", "tsx", "scripts/e2e/server.mjs"],
    REPO,
    backendEnv,
    `${TEMP_DIR}\\backend.out.log`,
    `${TEMP_DIR}\\backend.err.log`,
  );
  step(`waiting for backend port ${BACKEND_PORT}`);
  await waitForPort(BACKEND_PORT, 60_000);

  step("starting frontend dev server");
  const frontend = startProcess(
    process.execPath,
    ["node_modules/vite/bin/vite.js"],
    `${REPO}\\frontend`,
    { ...process.env, VITE_API_TARGET: `http://127.0.0.1:${BACKEND_PORT}` },
    `${TEMP_DIR}\\frontend.out.log`,
    `${TEMP_DIR}\\frontend.err.log`,
  );
  step(`waiting for frontend port ${FRONTEND_PORT}`);
  await waitForPort(FRONTEND_PORT, 60_000);

  step("running Playwright suite");
  const pwResult = spawnSync(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test", "--config", "e2e/playwright.config.ts"],
    {
      cwd: REPO,
      env: {
        ...process.env,
        E2E_SEED_STATE: SEED_STATE,
        E2E_BACKEND_URL: `http://127.0.0.1:${BACKEND_PORT}`,
        E2E_BASE_URL: `http://localhost:${FRONTEND_PORT}`,
        PLAYWRIGHT_HTML_OPEN: "never",
      },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  return pwResult.status ?? 1;
}

async function main() {
  step("=== Phase 14 E2E orchestration ===");
  const exitCode = await run();
  step(`e2e finished with exit code ${exitCode}`);
  teardown();
  process.exit(exitCode);
}

main().catch((error) => {
  console.error("[e2e-orchestrator] FATAL", error);
  teardown();
  process.exit(1);
});
