import test from "node:test";
import assert from "node:assert/strict";
import { selectGoodFirstIssues } from "../src/pipeline/issues.js";
import type { IssueItem } from "../src/types.js";

test("selectGoodFirstIssues keeps doc/quality starters and excludes secret/dependency", () => {
  const issues: IssueItem[] = [
    {
      id: "a",
      title: "Add docs",
      body: "",
      labels: ["documentation", "severity:med"],
      severity: "med",
      confidence: 0.9,
      evidence: [],
    },
    {
      id: "b",
      title: "Potential secret",
      body: "",
      labels: ["category:secret", "severity:med"],
      severity: "med",
      confidence: 0.9,
      evidence: [],
    },
    {
      id: "c",
      title: "Format script",
      body: "",
      labels: ["category:quality", "severity:low"],
      severity: "low",
      confidence: 0.76,
      evidence: [],
    },
  ];

  const result = selectGoodFirstIssues(issues);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, "a");
  assert.equal(result[1].id, "c");
});
