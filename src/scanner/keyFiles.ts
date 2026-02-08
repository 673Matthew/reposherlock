import type { FileIndexEntry, KeyFiles } from "../types.js";

export function detectKeyFiles(index: FileIndexEntry[]): KeyFiles {
  const readmeFiles = index
    .filter((entry) => /^readme/i.test(baseName(entry.relPath)))
    .map((entry) => entry.relPath);

  const find = (...candidates: string[]): string | undefined => {
    const normalized = candidates.map((x) => x.toLowerCase());
    const match = index.find((entry) => normalized.includes(entry.relPath.toLowerCase()));
    return match?.relPath;
  };

  const ciWorkflows = index
    .filter((entry) => entry.relPath.toLowerCase().startsWith(".github/workflows/"))
    .map((entry) => entry.relPath);

  const entrypointHints = [
    "src/cli",
    "src/index",
    "src/main",
    "src/app",
    "src/server",
    "src/commands/analyze",
    "src/commands/index",
    "src/bin",
    "bin",
    "cli",
    "index",
    "main",
    "app",
    "server",
  ];
  const rawEntrypoints = index
    .filter((entry) => entrypointHints.some((hint) => stripExt(entry.relPath).toLowerCase().endsWith(hint)))
    .map((entry) => entry.relPath)
    .slice(0, 30);
  const entrypoints = rawEntrypoints.filter((entry) => !isTestOrFixturePath(entry));

  return {
    readmeFiles,
    packageJson: find("package.json"),
    bunLock: find("bun.lockb", "bun.lock"),
    pnpmLock: find("pnpm-lock.yaml"),
    yarnLock: find("yarn.lock"),
    dockerfile: find("dockerfile"),
    dockerCompose: find("docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"),
    requirementsTxt: find("requirements.txt"),
    pyprojectToml: find("pyproject.toml"),
    makefile: find("makefile"),
    license: find("license", "license.md", "license.txt"),
    envExample: find(".env.example", ".env.sample", ".env.template"),
    ciWorkflows,
    entrypoints,
  };
}

function isTestOrFixturePath(relPath: string): boolean {
  const lower = relPath.toLowerCase();
  return (
    lower.includes("/test/") ||
    lower.includes("/tests/") ||
    lower.includes("/fixture/") ||
    lower.includes("/fixtures/") ||
    lower.includes("/example/") ||
    lower.includes("/examples/") ||
    lower.startsWith("test/") ||
    lower.startsWith("tests/")
  );
}

function baseName(path: string): string {
  const pieces = path.split("/");
  return pieces[pieces.length - 1] || path;
}

function stripExt(file: string): string {
  const i = file.lastIndexOf(".");
  if (i <= 0) {
    return file;
  }
  return file.slice(0, i);
}
