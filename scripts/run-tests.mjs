import "dotenv/config";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function fail(message) {
  console.error(`\nERROR: ${message}`);
  process.exit(1);
}

const devUrl = new URL(process.env.DATABASE_URL ?? "");
const testUrl = new URL(process.env.TEST_DATABASE_URL ?? "");
const testDirectUrl = process.env.TEST_DIRECT_URL ?? "";

if (!process.env.DATABASE_URL || !process.env.TEST_DATABASE_URL || !testDirectUrl) {
  fail("DATABASE_URL, TEST_DATABASE_URL and TEST_DIRECT_URL must be configured in .env");
}
if (devUrl.hostname === testUrl.hostname && devUrl.pathname === testUrl.pathname) {
  fail(
    `TEST_DATABASE_URL (${testUrl.pathname}) must reference a database different from DATABASE_URL (${devUrl.pathname}).`,
  );
}
if (!testUrl.pathname.toLowerCase().includes("test")) {
  fail(
    `TEST_DATABASE_URL must reference an isolated *_test database. Refusing to run against "${testUrl.pathname}".`,
  );
}

const run = (command, args, env) => {
  const result = spawnSync(command, args, {
    cwd: root,
    shell: true,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    fail(`Command failed: ${command} ${args.join(" ")}`);
  }
};

const testEnv = {
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  DIRECT_URL: testDirectUrl,
  RUN_TESTS: "1",
};

console.log(`\n=== Test database: ${testUrl.pathname} ===\n`);

const setup = spawnSync(process.execPath, [path.join(root, "scripts", "setup-test-db.mjs")], {
  cwd: root,
  stdio: "inherit",
});
if (setup.status !== 0) fail("Failed to ensure the test database exists.");

run("npx", ["prisma", "migrate", "deploy"], testEnv);
run("npx", ["tsx", "prisma/seed.ts"], testEnv);
run("npx", ["vitest", "run", "--config", "vitest.config.ts"], testEnv);

console.log("\nAll database integrity tests passed against the isolated test database.");
process.exit(0);