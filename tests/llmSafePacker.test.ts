import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildSafePromptPack } from "../src/llm/safePacker.js";

test("buildSafePromptPack strips secrets and respects char budget", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rs-llm-"));
  try {
    const readmeRel = "README.md";
    const envRel = ".env.example";
    await fs.writeFile(path.join(tmp, readmeRel), "Token: sk-12345678901234567890\nHello\n", "utf8");
    await fs.writeFile(path.join(tmp, envRel), "API_KEY=AKIA1234567890ABCDEF\n", "utf8");

    const fileIndex = [
      {
        absPath: path.join(tmp, readmeRel),
        relPath: readmeRel,
        sizeBytes: 32,
        ext: ".md",
        isBinary: false,
        depth: 0,
      },
      {
        absPath: path.join(tmp, envRel),
        relPath: envRel,
        sizeBytes: 30,
        ext: "",
        isBinary: false,
        depth: 0,
      },
    ];

    const summary = {
      repoIdentity: {
        input: tmp,
        resolvedPath: tmp,
        displayName: "demo/repo",
        sourceType: "local" as const,
      },
      generatedAt: new Date().toISOString(),
      languageBreakdown: [{ language: "TypeScript", count: 1, bytes: 20 }],
      keyFiles: {
        readmeFiles: [readmeRel],
        envExample: envRel,
        ciWorkflows: [],
        entrypoints: [],
      },
      classification: {
        projectType: "app" as const,
        runtime: "node" as const,
        frameworkGuess: null,
        confidence: 0.7,
      },
      runGuess: {
        installCommands: ["npm ci"],
        runCommands: ["npm run start"],
        testCommands: ["npm test"],
        configHints: [],
      },
      architecture: { nodes: [], edges: [], topModules: [] },
      risks: [
        {
          id: "secret-x",
          category: "secret" as const,
          severity: "high" as const,
          confidence: 0.9,
          title: "Potential secret",
          description: "x",
          evidence: ["README.md:sk-123"],
        },
      ],
      issues: [
        {
          id: "issue-secret",
          title: "Potential secret",
          body: "check",
          labels: ["category:secret"],
          severity: "high" as const,
          confidence: 0.8,
          evidence: ["README.md"],
        },
      ],
    };

    const pack = await buildSafePromptPack({
      rootDir: tmp,
      fileIndex,
      keyFiles: summary.keyFiles,
      summary,
      risks: summary.risks,
      config: {
        provider: "openai",
        model: "x",
        baseUrl: "https://example.com",
        apiKey: "k",
        maxChars: 1200,
        perFileChars: 80,
      },
    });

    assert.ok(pack.totalChars <= 1200);
    assert.ok(!pack.summaryJson.includes("category\": \"secret\""));
    const excerptBlob = pack.excerpts.map((x) => x.content).join("\n");
    assert.ok(!excerptBlob.includes("sk-"));
    assert.ok(!excerptBlob.includes("AKIA"));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
