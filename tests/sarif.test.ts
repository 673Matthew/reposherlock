import test from "node:test";
import assert from "node:assert/strict";
import { buildIssuesSarif } from "../src/output/sarif.js";

test("buildIssuesSarif converts issues to SARIF document", () => {
  const sarif = buildIssuesSarif({
    generatedAt: "2026-02-07T00:00:00.000Z",
    repoIdentity: {
      input: ".",
      resolvedPath: "/tmp/demo",
      displayName: "demo/repo",
      sourceType: "local",
    },
    config: {
      generatedAt: "2026-02-07T00:00:00.000Z",
      toolVersion: "0.1.0",
      analyzeOptions: {
        outDir: ".reposherlock/output/x",
        format: ["md", "json"],
        depth: 6,
        maxFiles: 200,
        includeTests: true,
        tryRun: false,
        timeoutSeconds: 120,
        noNetwork: false,
        redactSecrets: true,
        verbose: false,
        llm: false,
        llmProvider: "openai",
        llmMaxChars: 80_000,
        llmPerFileChars: 12_000,
        tryRunPython: false,
      },
    },
    issues: [
      {
        id: "issue-1",
        title: "Missing CI",
        body: "Add CI workflow.",
        labels: ["ci", "severity:med"],
        severity: "med",
        confidence: 0.8,
        evidence: [".github/workflows/"],
      },
    ],
  });

  assert.equal(sarif.version, "2.1.0");
  assert.equal(sarif.runs[0].results.length, 1);
  assert.equal(sarif.runs[0].results[0].level, "warning");
  assert.equal(sarif.runs[0].tool.driver.rules[0].id, "issue-1");
});
