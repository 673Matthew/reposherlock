import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildRunPlan } from "../src/run/planner.js";
import { createDefaultTryRunPolicy } from "../src/run/policy.js";

test("buildRunPlan selects node-bun strategy with package scripts", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rs-plan-"));
  try {
    await fs.writeFile(
      path.join(tmp, "package.json"),
      JSON.stringify({ scripts: { test: "vitest", start: "node src/index.js" } }, null, 2),
      "utf8",
    );

    const plan = await buildRunPlan({
      rootDir: tmp,
      timeoutSeconds: 120,
      tryRunPython: false,
      keyFiles: {
        readmeFiles: [],
        ciWorkflows: [],
        entrypoints: [],
        packageJson: "package.json",
      },
      policy: createDefaultTryRunPolicy(),
    });

    assert.equal(plan.strategy, "node-bun");
    assert.ok(plan.proposedCommands.some((cmd) => cmd.includes("run test")));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("buildRunPlan blocks scripts with non-allowlisted entrypoint", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rs-plan-block-"));
  try {
    await fs.writeFile(
      path.join(tmp, "package.json"),
      JSON.stringify({ scripts: { test: "customrunner --do-thing" } }, null, 2),
      "utf8",
    );

    const plan = await buildRunPlan({
      rootDir: tmp,
      timeoutSeconds: 120,
      tryRunPython: false,
      keyFiles: {
        readmeFiles: [],
        ciWorkflows: [],
        entrypoints: [],
        packageJson: "package.json",
      },
      policy: createDefaultTryRunPolicy(),
    });

    assert.equal(plan.strategy, "node-bun");
    const testCmd = plan.executableCommands.find((cmd) => cmd.args.join(" ") === "run test");
    assert.ok(testCmd);
    assert.equal(testCmd.run, false);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("buildRunPlan adds --help tail for CLI start scripts", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rs-plan-cli-"));
  try {
    await fs.writeFile(
      path.join(tmp, "package.json"),
      JSON.stringify({ bin: "dist/cli.js", scripts: { start: "node dist/cli.js" } }, null, 2),
      "utf8",
    );

    const plan = await buildRunPlan({
      rootDir: tmp,
      timeoutSeconds: 120,
      tryRunPython: false,
      keyFiles: {
        readmeFiles: [],
        ciWorkflows: [],
        entrypoints: [],
        packageJson: "package.json",
      },
      policy: createDefaultTryRunPolicy(),
    });

    const startCmd = plan.executableCommands.find((cmd) => cmd.args[1] === "start");
    assert.ok(startCmd);
    assert.deepEqual(startCmd.args.slice(2), ["--", "--help"]);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
