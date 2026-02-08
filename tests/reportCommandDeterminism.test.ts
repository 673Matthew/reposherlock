import test from "node:test";
import assert from "node:assert/strict";
import { renderReportMarkdown } from "../src/output/renderers.js";
import type { ConfigSnapshot, DeterministicSummary } from "../src/types.js";

test("renderReportMarkdown keeps suggested commands deterministic from planner", () => {
  const summary: DeterministicSummary = {
    repoIdentity: {
      input: "https://github.com/example/project",
      resolvedPath: "/tmp/project",
      displayName: "example/project",
      sourceType: "github-clone",
      commitOrRef: "abc123",
    },
    generatedAt: "2026-02-08T00:00:00.000Z",
    languageBreakdown: [{ language: "TypeScript", count: 5, bytes: 1234 }],
    metrics: {
      filesScanned: 20,
      textFilesScanned: 20,
      tsJsFiles: 10,
      tsJsParsed: 10,
      parsedModules: 8,
      moduleMapCoverage: 1,
      skippedBinaryOrLarge: 0,
      warningsCount: 0,
    },
    keyFiles: {
      readmeFiles: ["README.md"],
      packageJson: "package.json",
      ciWorkflows: [],
      entrypoints: ["src/index.ts"],
    },
    classification: {
      projectType: "app",
      runtime: "node",
      frameworkGuess: "react",
      confidence: 0.8,
    },
    runGuess: {
      installCommands: ["bun install"],
      testCommands: ["bun run test"],
      runCommands: ["bun run start"],
      configHints: [],
    },
    envAnalysis: {
      required: [],
      requiredByFlags: [],
      optional: [],
      mentioned: [],
      filteredOut: [],
    },
    formatting: {
      detectedTools: [],
      dependencyTools: [],
      configFiles: [],
      hasFormatScript: false,
      hasLintScript: false,
      formatScriptNames: [],
      lintScriptNames: [],
      evidence: [],
    },
    evidence: {
      classification: [],
      purpose: [],
      run: [],
      env: [],
      architecture: [],
    },
    architecture: {
      nodes: [],
      edges: [],
      topModules: [],
      metrics: {
        sourceFiles: 10,
        parsedFiles: 8,
        tsJsSourceFiles: 10,
        tsJsParsedFiles: 10,
        connectedFiles: 8,
        parseCoverage: 0.8,
        tsJsCoverage: 1,
      },
    },
    risks: [],
    issues: [],
    tryRun: {
      attempted: true,
      summary: "Run attempt completed successfully; start command ran in help mode only (startup not verified).",
      planner: {
        strategy: "node-bun",
        reason: "package.json detected",
        proposedCommands: ["npm ci", "npm run test", "npm run start -- --help"],
        executableCommands: [],
      },
      executions: [
        {
          command: "npm",
          args: ["ci"],
          step: "install",
          helpMode: false,
          cwd: "/tmp/project",
          durationMs: 1000,
          exitCode: 0,
          timedOut: false,
          stdoutSnippet: "",
          stderrSnippet: "",
          classification: "success",
          verificationStatus: "verified",
          verificationEvidence: "dependency installation signal detected in logs",
          probableFixes: [],
        },
        {
          command: "npm",
          args: ["run", "start", "--", "--help"],
          step: "start",
          helpMode: true,
          cwd: "/tmp/project",
          durationMs: 400,
          exitCode: 0,
          timedOut: false,
          stdoutSnippet: "",
          stderrSnippet: "",
          classification: "success",
          verificationStatus: "partial",
          verificationEvidence: "help output only; runtime startup was not verified",
          probableFixes: [],
        },
      ],
    },
  };

  const config: ConfigSnapshot = {
    analyzeOptions: {
      outDir: ".reposherlock/output/test",
      format: ["md", "json"],
      depth: 6,
      maxFiles: 2500,
      includeTests: true,
      tryRun: true,
      timeoutSeconds: 120,
      noNetwork: false,
      redactSecrets: true,
      verbose: false,
      llm: true,
      llmProvider: "openai",
      llmModel: "gpt-5-mini",
      llmApiKey: undefined,
      llmMaxChars: 80_000,
      llmPerFileChars: 12_000,
      tryRunPython: false,
      prDraft: false,
      animation: false,
    },
    generatedAt: "2026-02-08T00:00:00.000Z",
    toolVersion: "0.1.0",
  };

  const report = renderReportMarkdown({
    summary,
    likelyPurpose: "demo",
    envHints: [],
    envAnalysis: summary.envAnalysis!,
    detectedLicense: "MIT",
    formatting: summary.formatting!,
    config,
    llmUsed: false,
  });

  assert.ok(report.includes("`npm run test` (found by deterministic script detection, not executed)"));
  assert.ok(!report.includes("`bun run test`"));
  assert.ok(report.includes("`npm run start -- --help` - partial"));
  assert.ok(report.includes("- Start verification: help output only (server startup not validated)"));
});

test("renderReportMarkdown reports timeout before help-mode verification wording", () => {
  const summary: DeterministicSummary = {
    repoIdentity: {
      input: "https://github.com/example/project",
      resolvedPath: "/tmp/project",
      displayName: "example/project",
      sourceType: "github-clone",
      commitOrRef: "abc123",
    },
    generatedAt: "2026-02-08T00:00:00.000Z",
    languageBreakdown: [{ language: "TypeScript", count: 5, bytes: 1234 }],
    metrics: {
      filesScanned: 20,
      textFilesScanned: 20,
      tsJsFiles: 10,
      tsJsParsed: 10,
      parsedModules: 8,
      moduleMapCoverage: 1,
      skippedBinaryOrLarge: 0,
      warningsCount: 0,
    },
    keyFiles: {
      readmeFiles: ["README.md"],
      packageJson: "package.json",
      ciWorkflows: [],
      entrypoints: ["src/index.ts"],
    },
    classification: {
      projectType: "app",
      runtime: "node",
      frameworkGuess: "react",
      confidence: 0.8,
    },
    runGuess: {
      installCommands: ["bun install"],
      testCommands: ["bun run test"],
      runCommands: ["bun run start"],
      configHints: [],
    },
    envAnalysis: {
      required: [],
      requiredByFlags: [],
      optional: [],
      mentioned: [],
      filteredOut: [],
    },
    formatting: {
      detectedTools: [],
      dependencyTools: [],
      configFiles: [],
      hasFormatScript: false,
      hasLintScript: false,
      formatScriptNames: [],
      lintScriptNames: [],
      evidence: [],
    },
    evidence: {
      classification: [],
      purpose: [],
      run: [],
      env: [],
      architecture: [],
    },
    architecture: {
      nodes: [],
      edges: [],
      topModules: [],
      metrics: {
        sourceFiles: 10,
        parsedFiles: 8,
        tsJsSourceFiles: 10,
        tsJsParsedFiles: 10,
        connectedFiles: 8,
        parseCoverage: 0.8,
        tsJsCoverage: 1,
      },
    },
    risks: [],
    issues: [],
    tryRun: {
      attempted: true,
      summary: "Run attempt failed at 'npm run start -- --help'.",
      planner: {
        strategy: "node-bun",
        reason: "package.json detected",
        proposedCommands: ["npm run start -- --help"],
        executableCommands: [],
      },
      executions: [
        {
          command: "npm",
          args: ["run", "start", "--", "--help"],
          step: "start",
          helpMode: true,
          cwd: "/tmp/project",
          durationMs: 120_000,
          exitCode: null,
          timedOut: true,
          stdoutSnippet: "",
          stderrSnippet: "",
          classification: "unknown",
          verificationStatus: "failed",
          verificationEvidence: "command timed out before verification could complete",
          probableFixes: [],
        },
      ],
    },
  };

  const config: ConfigSnapshot = {
    analyzeOptions: {
      outDir: ".reposherlock/output/test",
      format: ["md", "json"],
      depth: 6,
      maxFiles: 2500,
      includeTests: true,
      tryRun: true,
      timeoutSeconds: 120,
      noNetwork: false,
      redactSecrets: true,
      verbose: false,
      llm: true,
      llmProvider: "openai",
      llmModel: "gpt-5-mini",
      llmApiKey: undefined,
      llmMaxChars: 80_000,
      llmPerFileChars: 12_000,
      tryRunPython: false,
      prDraft: false,
      animation: false,
    },
    generatedAt: "2026-02-08T00:00:00.000Z",
    toolVersion: "0.1.0",
  };

  const report = renderReportMarkdown({
    summary,
    likelyPurpose: "demo",
    envHints: [],
    envAnalysis: summary.envAnalysis!,
    detectedLicense: "MIT",
    formatting: summary.formatting!,
    config,
    llmUsed: false,
  });

  assert.ok(report.includes("`npm run start -- --help` - failed"));
  assert.ok(report.includes("- Start verification: not validated (timeout)"));
  assert.ok(!report.includes("- Start verification: help output only (server startup not validated)"));
});
