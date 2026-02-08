import fs from "node:fs/promises";
import path from "node:path";
import type { FileIndexEntry } from "../types.js";
import { isProbablyBinaryByExt } from "../utils/fs.js";
import { relPosix } from "../utils/path.js";

export interface BuildFileIndexOptions {
  rootDir: string;
  maxDepth: number;
  maxFiles: number;
  includeTests: boolean;
}

const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  ".reposherlock",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  ".idea",
  ".vscode",
]);

export async function buildFileIndex(options: BuildFileIndexOptions): Promise<FileIndexEntry[]> {
  const entries: FileIndexEntry[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (entries.length >= options.maxFiles) {
      return;
    }
    if (depth > options.maxDepth) {
      return;
    }

    const children = await fs.readdir(dir, { withFileTypes: true });
    for (const child of children) {
      if (entries.length >= options.maxFiles) {
        break;
      }
      if (child.name.startsWith(".")) {
        if (child.name === ".env.example" || child.name.startsWith(".github")) {
          // keep scanning
        } else if (child.isDirectory()) {
          continue;
        }
      }

      if (child.isDirectory()) {
        if (EXCLUDED_DIRS.has(child.name)) {
          continue;
        }
        if (!options.includeTests && isTestDirectory(child.name)) {
          continue;
        }
        await walk(path.join(dir, child.name), depth + 1);
        continue;
      }

      if (!options.includeTests && isTestPath(child.name)) {
        continue;
      }

      const absPath = path.join(dir, child.name);
      const stat = await fs.stat(absPath);
      if (!stat.isFile()) {
        continue;
      }

      entries.push({
        absPath,
        relPath: relPosix(options.rootDir, absPath),
        sizeBytes: stat.size,
        ext: path.extname(child.name).toLowerCase(),
        isBinary: isProbablyBinaryByExt(child.name),
        depth,
      });
    }
  }

  await walk(options.rootDir, 0);
  entries.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return entries;
}

function isTestPath(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes(".test.") ||
    lower.includes(".spec.") ||
    lower.endsWith("test.ts") ||
    lower.endsWith("test.js")
  );
}

function isTestDirectory(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "test" || lower === "tests" || lower === "__tests__";
}
