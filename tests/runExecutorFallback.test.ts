import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeRunPlan } from "../src/run/executor.js";
import type { RunPlan } from "../src/types.js";

test("executeRunPlan continues to fallback start command after help-mode timeout", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rs-exec-fallback-"));
  try {
    await fs.writeFile(path.join(tmp, "README.md"), "fallback fixture\n", "utf8");

    const plan: RunPlan = {
      strategy: "node-bun",
      reason: "test fixture",
      proposedCommands: ["sh -c 'sleep 5' start --help", "sh -c 'echo ok' start --help"],
      executableCommands: [
        {
          command: "sh",
          args: ["-c", "sleep 5", "start", "--help"],
          run: true,
          why: "first start command times out",
        },
        {
          command: "sh",
          args: ["-c", "echo ok", "start", "--help"],
          run: true,
          why: "fallback start command",
        },
      ],
    };

    const result = await executeRunPlan({
      sourceRepoPath: tmp,
      plan,
      timeoutSeconds: 1,
      maxOutputChars: 20_000,
    });

    assert.equal(result.attempted, true);
    assert.equal(result.executions.length, 2);
    assert.equal(result.executions[0].timedOut, true);
    assert.equal(result.executions[0].verificationStatus, "failed");
    assert.equal(result.executions[1].classification, "success");
    assert.equal(result.executions[1].verificationStatus, "partial");
    assert.equal(result.summary, "Run attempt recovered after start timeout via fallback command.");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
