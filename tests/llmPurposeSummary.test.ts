import test from "node:test";
import assert from "node:assert/strict";
import { runLlmPolishPass } from "../src/llm/polish.js";
import type { DeterministicSummary, LlmPromptPack } from "../src/types.js";

class StubProvider {
  public calls: string[] = [];
  private readonly responses: string[];

  constructor(responses: string[]) {
    this.responses = responses;
  }

  async complete(messages: Array<{ role: "system" | "user"; content: string }>): Promise<string> {
    this.calls.push(messages.map((message) => `${message.role}:${message.content}`).join("\n\n"));
    return this.responses[this.calls.length - 1] || "";
  }
}

test("runLlmPolishPass builds repo purpose from README excerpts", async () => {
  const provider = new StubProvider([
    "- RepoSherlock analyzes GitHub repos and produces architecture, run, risk, and issue outputs.",
    "# README 2.0",
    "[]",
    "# Report",
  ]);

  const summary: DeterministicSummary = {
    repoIdentity: {
      input: "https://github.com/acme/sample",
      resolvedPath: "/tmp/sample",
      displayName: "acme/sample",
      sourceType: "github-clone",
    },
    generatedAt: "2026-02-08T00:00:00.000Z",
    languageBreakdown: [{ language: "TypeScript", count: 1, bytes: 120 }],
    keyFiles: {
      readmeFiles: ["README.md"],
      ciWorkflows: [],
      entrypoints: [],
    },
    classification: {
      projectType: "app",
      runtime: "node",
      frameworkGuess: null,
      confidence: 0.6,
    },
    runGuess: {
      installCommands: [],
      runCommands: [],
      testCommands: [],
      configHints: [],
    },
    architecture: {
      nodes: [],
      edges: [],
      topModules: [],
      metrics: {
        sourceFiles: 1,
        parsedFiles: 1,
        tsJsSourceFiles: 1,
        tsJsParsedFiles: 1,
        connectedFiles: 0,
        parseCoverage: 1,
        tsJsCoverage: 1,
      },
    },
    risks: [],
    issues: [],
  };

  const promptPack: LlmPromptPack = {
    disclaimer: "LLM-assisted text generation enabled; verify instructions.",
    summaryJson: JSON.stringify({ projectType: "app" }),
    excerpts: [
      {
        file: "README.md",
        content: "RepoSherlock analyzes repositories and generates reports.",
        truncated: false,
      },
    ],
    totalChars: 120,
    droppedFiles: [],
  };

  const output = await runLlmPolishPass({
    provider,
    promptPack,
    deterministicReport: "# Report",
    deterministicReadme: "# README",
    deterministicIssues: [],
    summary,
  });

  assert.equal(
    output.purposeSummary,
    "RepoSherlock analyzes GitHub repos and produces architecture, run, risk, and issue outputs.",
  );
  assert.ok(provider.calls[0]?.includes("### README excerpts"));
  assert.ok(provider.calls[0]?.includes("README.md"));
});
