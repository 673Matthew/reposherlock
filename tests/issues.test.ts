import test from "node:test";
import assert from "node:assert/strict";
import { generateActionableIssues } from "../src/pipeline/issues.js";

test("generateActionableIssues emits env and risk-driven issues", () => {
  const issues = generateActionableIssues({
    risks: [
      {
        id: "r1",
        category: "ci",
        severity: "med",
        confidence: 0.9,
        title: "No CI workflow detected",
        description: "No workflows",
        evidence: [".github/workflows missing"],
      },
    ],
    architecture: {
      nodes: [{ id: "src/hot.ts", path: "src/hot.ts", degree: 8 }],
      edges: [],
      topModules: [{ id: "src/hot.ts", path: "src/hot.ts", degree: 8 }],
    },
    keyFiles: {
      readmeFiles: [],
      ciWorkflows: [],
      entrypoints: [],
    },
    envHints: ["DATABASE_URL"],
  });

  const envIssue = issues.find((i) => i.title.includes(".env.example"));
  assert.ok(envIssue);
  assert.ok(envIssue.evidence.some((line) => line.includes(".env.example check: not found")));
  assert.ok(envIssue.evidence.some((line) => line.toLowerCase().includes("readme env/config docs")));
  assert.ok(issues.some((i) => i.title.toLowerCase().includes("high-centrality")));
  assert.ok(issues.some((i) => i.title.toLowerCase().includes("readme")));
});

test("generateActionableIssues skips env example issue for flag-only env requirements", () => {
  const issues = generateActionableIssues({
    risks: [],
    architecture: {
      nodes: [],
      edges: [],
      topModules: [],
    },
    keyFiles: {
      readmeFiles: ["README.md"],
      ciWorkflows: [],
      entrypoints: [],
    },
    envAnalysis: {
      required: [],
      requiredByFlags: [
        {
          name: "LLM_API_KEY",
          confidence: 0.9,
          evidence: [
            {
              source: "flag requirement",
              path: "cli options",
              snippet: "Triggered by --llm-mandatory",
            },
          ],
        },
      ],
      optional: [],
      mentioned: [],
      filteredOut: [],
    },
  });

  assert.equal(issues.some((issue) => issue.id === "issue-env-example-missing"), false);
});
