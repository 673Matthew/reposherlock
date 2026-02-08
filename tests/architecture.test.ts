import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildFileIndex } from "../src/scanner/fileIndexer.js";
import { buildArchitectureMap } from "../src/parsers/moduleMap.js";

test("buildArchitectureMap creates local module edges", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rs-arch-"));
  try {
    await fs.mkdir(path.join(tmp, "src"), { recursive: true });
    await fs.writeFile(path.join(tmp, "src", "a.ts"), "import {b} from './b.js'; export const a = b;", "utf8");
    await fs.writeFile(path.join(tmp, "src", "b.ts"), "export const b = 1;", "utf8");

    const index = await buildFileIndex({ rootDir: tmp, maxDepth: 4, maxFiles: 50, includeTests: true });
    const architecture = await buildArchitectureMap(tmp, index);

    const edge = architecture.edges.find((e) => e.from === "src/a.ts" && e.to === "src/b.ts");
    assert.ok(edge);
    assert.ok(architecture.topModules.length >= 1);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
