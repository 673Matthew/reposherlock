import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadTryRunPolicy } from "../src/run/policy.js";

test("loadTryRunPolicy merges repo policy file", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rs-policy-"));
  try {
    await fs.mkdir(path.join(tmp, ".reposherlock"), { recursive: true });
    await fs.writeFile(
      path.join(tmp, ".reposherlock", "try-run-policy.json"),
      JSON.stringify(
        {
          allowedCommands: ["npm", "node"],
          allowedScriptEntrypoints: ["node"],
          blockedScriptEntrypoints: ["curl"],
          scriptPriority: ["build", "test", "start"],
        },
        null,
        2,
      ),
      "utf8",
    );

    const policy = await loadTryRunPolicy(tmp);
    assert.equal(policy.source.endsWith("try-run-policy.json"), true);
    assert.deepEqual(policy.allowedCommands, ["npm", "node"]);
    assert.deepEqual(policy.scriptPriority, ["build", "test", "start"]);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
