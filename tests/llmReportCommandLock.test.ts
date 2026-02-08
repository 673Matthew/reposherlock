import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeAllArtifacts } from "../src/output/writer.js";
import { renderReportMarkdown } from "../src/output/renderers.js";
import type { ConfigSnapshot, DeterministicSummary } from "../src/types.js";

test("LLM report polish cannot override deterministic run commands", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rs-llm-lock-"));
  try {
    const summary: DeterministicSummary = {
      repoIdentity: {
        input: "https://github.com/example/project",
        resolvedPath: "/tmp/project",
        displayName: "example/project",
        sourceType: "github-clone",
      },
      generatedAt: "2026-02-08T00:00:00.000Z",
      languageBreakdown: [{ language: "TypeScript", count: 3, bytes: 999 }],
      metrics: {
        filesScanned: 3,
        textFilesScanned: 3,
        tsJsFiles: 2,
        tsJsParsed: 2,
        parsedModules: 2,
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
        frameworkGuess: null,
        confidence: 0.7,
      },
      runGuess: {
        installCommands: ["npm ci"],
        testCommands: ["npm run test"],
        runCommands: ["npm run start"],
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
          sourceFiles: 2,
          parsedFiles: 2,
          tsJsSourceFiles: 2,
          tsJsParsedFiles: 2,
          connectedFiles: 2,
          parseCoverage: 1,
          tsJsCoverage: 1,
        },
      },
      risks: [],
      issues: [],
    };

    const config: ConfigSnapshot = {
      analyzeOptions: {
        outDir: tmp,
        format: ["md", "json"],
        depth: 6,
        maxFiles: 2500,
        includeTests: true,
        tryRun: false,
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
      generatedAt: summary.generatedAt,
      toolVersion: "0.1.0",
    };

    const deterministicReport = renderReportMarkdown({
      summary,
      likelyPurpose: "demo",
      envHints: [],
      envAnalysis: summary.envAnalysis!,
      detectedLicense: "MIT",
      formatting: summary.formatting!,
      config,
      llmUsed: false,
    });
    const llmMutatedReport = deterministicReport.replace(/`npm run test`/g, "`bun test`");

    await writeAllArtifacts({
      outputDir: tmp,
      summary,
      fileIndex: [],
      risks: [],
      issues: [],
      likelyPurpose: "demo",
      envHints: [],
      envAnalysis: summary.envAnalysis!,
      formatting: summary.formatting!,
      detectedLicense: "MIT",
      config,
      llmUsed: true,
      llmResult: {
        report: llmMutatedReport,
        readme: "README placeholder",
        issuesJson: [],
        notes: [],
      },
    });

    const report = await fs.readFile(path.join(tmp, "report.md"), "utf8");
    assert.ok(report.includes("`npm run test`"));
    assert.ok(!report.includes("`bun test`"));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
