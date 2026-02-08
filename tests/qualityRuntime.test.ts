import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectCiAndQuality } from "../src/risk/ci.js";
import type { FileIndexEntry, KeyFiles } from "../src/types.js";

test("detectCiAndQuality uses python-specific formatting diagnostics", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rs-quality-python-"));
  try {
    await fs.writeFile(
      path.join(tmp, "pyproject.toml"),
      [
        "[project]",
        'name = "demo-python"',
        'version = "0.1.0"',
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(path.join(tmp, "app.py"), "print('hello')\n", "utf8");

    const keyFiles: KeyFiles = {
      readmeFiles: ["README.md"],
      pyprojectToml: "pyproject.toml",
      ciWorkflows: [],
      entrypoints: [],
    };

    const fileIndex: FileIndexEntry[] = [
      {
        absPath: path.join(tmp, "pyproject.toml"),
        relPath: "pyproject.toml",
        sizeBytes: 128,
        ext: ".toml",
        isBinary: false,
        depth: 0,
      },
      {
        absPath: path.join(tmp, "app.py"),
        relPath: "app.py",
        sizeBytes: 16,
        ext: ".py",
        isBinary: false,
        depth: 0,
      },
    ];

    const result = await detectCiAndQuality(tmp, keyFiles, fileIndex);
    const pythonSignal = result.qualitySignals.find((signal) => signal.id === "quality-no-python-tooling");
    assert.ok(pythonSignal);
    assert.ok(!pythonSignal.evidence.some((line) => line.toLowerCase().includes("package.json")));
    assert.ok(!result.qualitySignals.some((signal) => signal.id === "quality-no-format-tooling"));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
