import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildRunPlan } from "../src/run/planner.js";
import { createDefaultTryRunPolicy } from "../src/run/policy.js";

test("try-run planner prefers script-based plan for package projects", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "reposherlock-test-plan-"));
  try {
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { test: "bun test", dev: "bun run dev" } }, null, 2),
      "utf8",
    );
    await fs.writeFile(path.join(root, "bun.lockb"), "", "utf8");

    const plan = await buildRunPlan({
      rootDir: root,
      keyFiles: {
        readmeFiles: [],
        packageJson: "package.json",
        bunLock: "bun.lockb",
        pnpmLock: undefined,
        yarnLock: undefined,
        dockerfile: undefined,
        dockerCompose: undefined,
        requirementsTxt: undefined,
        pyprojectToml: undefined,
        makefile: undefined,
        license: undefined,
        envExample: undefined,
        ciWorkflows: [],
        entrypoints: [],
      },
      timeoutSeconds: 60,
      tryRunPython: false,
      policy: createDefaultTryRunPolicy(),
    });

    assert.equal(plan.strategy, "node-bun");
    assert.ok(plan.proposedCommands.some((cmd) => cmd.includes("install") || cmd.includes(" ci")));
    assert.ok(plan.proposedCommands.some((cmd) => cmd.includes("run test")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
