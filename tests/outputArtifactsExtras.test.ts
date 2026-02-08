import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runAnalyzePipeline } from "../src/pipeline/analyzePipeline.js";
import { copyDirRecursive } from "../src/utils/fs.js";

const FIXTURE_DIR = path.resolve(process.cwd(), "tests/fixtures/simple-node");

test("writes good-first issues and optional pr draft artifacts", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rs-extra-artifacts-"));
  const repo = path.join(tmp, "repo");

  try {
    await copyDirRecursive(FIXTURE_DIR, repo);
    await runAnalyzePipeline({
      target: ".",
      workspaceRoot: repo,
      options: {
        outDir: ".reposherlock/output/extra-artifacts",
        format: ["md", "json"],
        depth: 6,
        maxFiles: 800,
        includeTests: true,
        tryRun: false,
        timeoutSeconds: 120,
        noNetwork: true,
        redactSecrets: true,
        verbose: false,
        llm: false,
        llmProvider: "openai",
        llmMaxChars: 80_000,
        llmPerFileChars: 12_000,
        tryRunPython: false,
        prDraft: true,
        animation: false,
      },
    });

    const outDir = path.join(repo, ".reposherlock", "output", "extra-artifacts");
    await fs.access(path.join(outDir, "issues.good-first.json"));
    await fs.access(path.join(outDir, "issues.good-first.md"));
    await fs.access(path.join(outDir, "pr_draft.md"));

    const payload = JSON.parse(await fs.readFile(path.join(outDir, "issues.good-first.json"), "utf8")) as {
      issues?: unknown[];
    };
    assert.ok(Array.isArray(payload.issues));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
