import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runAnalyzePipeline } from "../src/pipeline/analyzePipeline.js";
import { copyDirRecursive } from "../src/utils/fs.js";

const FIXTURE_DIR = path.resolve(process.cwd(), "tests/fixtures/simple-node");
const SNAPSHOT_DIR = path.resolve(process.cwd(), "tests/snapshots");

test("artifact snapshots: report.md / issues.json / architecture.json", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rs-snapshot-"));
  const repo = path.join(tmp, "repo");

  try {
    await copyDirRecursive(FIXTURE_DIR, repo);

    await runAnalyzePipeline({
      target: ".",
      workspaceRoot: repo,
      options: {
        outDir: ".reposherlock/output/snapshot",
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
      },
    });

    const outDir = path.join(repo, ".reposherlock", "output", "snapshot");

    const reportText = await fs.readFile(path.join(outDir, "report.md"), "utf8");
    const reportSnapshot = await fs.readFile(path.join(SNAPSHOT_DIR, "report.md.snap"), "utf8");
    assert.equal(normalizeReport(reportText), reportSnapshot);

    const issuesJson = JSON.parse(await fs.readFile(path.join(outDir, "issues.json"), "utf8")) as {
      issues: unknown;
    };
    const issuesSnapshot = await fs.readFile(path.join(SNAPSHOT_DIR, "issues.json.snap"), "utf8");
    assert.equal(`${JSON.stringify(issuesJson.issues, null, 2)}\n`, issuesSnapshot);

    const architectureJson = JSON.parse(await fs.readFile(path.join(outDir, "architecture.json"), "utf8")) as {
      architecture: unknown;
    };
    const architectureSnapshot = await fs.readFile(path.join(SNAPSHOT_DIR, "architecture.json.snap"), "utf8");
    assert.equal(`${JSON.stringify(architectureJson.architecture, null, 2)}\n`, architectureSnapshot);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

function normalizeReport(input: string): string {
  return (
    input
      .replace(/generated_at: .*/g, "generated_at: <TIMESTAMP>")
      .replace(/repo_name: .*/g, "repo_name: <REPO_NAME>")
      .replace(/config_snapshot: '.*'/g, "config_snapshot: '<CONFIG>'")
      .replace(/Confidence: \d+\.\d+/g, "Confidence: <CONFIDENCE>")
      .trimEnd() + "\n"
  );
}
