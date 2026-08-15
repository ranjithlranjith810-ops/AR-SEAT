import "dotenv/config";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const file = process.argv[2];

if (!file) {
  console.error("usage: node scripts/run-one-test.mjs <relative-or-absolute-test-file>");
  process.exit(1);
}

const target = path.isAbsolute(file) ? file : path.join("tests", file);
const env = {
  ...process.env,
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  DIRECT_URL: process.env.TEST_DIRECT_URL,
  RUN_TESTS: "1",
  SOLVER_INTERNAL_TOKEN: "test-internal-token",
};

const child = spawn("npx", ["vitest", "run", target, "--no-color"], {
  cwd: root,
  shell: true,
  stdio: "inherit",
  env,
});
child.on("exit", (code) => process.exit(code ?? 1));