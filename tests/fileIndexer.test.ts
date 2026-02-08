import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildFileIndex } from "../src/scanner/fileIndexer.js";

test("file indexer respects excludes and includeTests=false", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rs-index-"));
  try {
    await fs.mkdir(path.join(tmp, "src"), { recursive: true });
    await fs.mkdir(path.join(tmp, "tests"), { recursive: true });
    await fs.mkdir(path.join(tmp, "node_modules", "left-pad"), { recursive: true });

    await fs.writeFile(path.join(tmp, "src", "index.ts"), "export const a = 1;\n", "utf8");
    await fs.writeFile(path.join(tmp, "tests", "index.test.ts"), "test('x',()=>{});\n", "utf8");
    await fs.writeFile(path.join(tmp, "node_modules", "left-pad", "index.js"), "module.exports = {};\n", "utf8");

    const index = await buildFileIndex({
      rootDir: tmp,
      maxDepth: 4,
      maxFiles: 50,
      includeTests: false,
    });

    const rels = index.map((f) => f.relPath);
    assert.ok(rels.includes("src/index.ts"));
    assert.ok(!rels.some((x) => x.includes("tests")));
    assert.ok(!rels.some((x) => x.includes("node_modules")));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
