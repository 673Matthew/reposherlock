import fs from "node:fs/promises";
import path from "node:path";
import type { TryRunPolicy } from "../types.js";

interface RawTryRunPolicy {
  scriptPriority?: string[];
  allowedCommands?: string[];
  allowedScriptEntrypoints?: string[];
  blockedScriptEntrypoints?: string[];
}

const DEFAULT_SCRIPT_PRIORITY = ["test", "lint", "build", "start", "dev"];
const DEFAULT_ALLOWED_COMMANDS = ["docker", "bun", "npm", "pnpm", "yarn", "make", "python", "pytest"];
const DEFAULT_ALLOWED_SCRIPT_ENTRYPOINTS = [
  "node",
  "npm",
  "npx",
  "bun",
  "pnpm",
  "yarn",
  "tsx",
  "ts-node",
  "vite",
  "vitest",
  "next",
  "react-scripts",
  "jest",
  "eslint",
  "prettier",
  "tsc",
  "turbo",
  "webpack",
  "rollup",
  "docker",
  "make",
  "python",
  "pytest",
  "go",
  "cargo",
  "uv",
];

const DEFAULT_BLOCKED_SCRIPT_ENTRYPOINTS = [
  "curl",
  "wget",
  "bash",
  "sh",
  "zsh",
  "powershell",
  "pwsh",
  "cmd",
];

export async function loadTryRunPolicy(rootDir: string, overridePath?: string): Promise<TryRunPolicy> {
  const defaults = createDefaultTryRunPolicy();
  const candidatePaths = overridePath
    ? [resolvePolicyPath(rootDir, overridePath)]
    : [
        path.join(rootDir, ".reposherlock", "try-run-policy.json"),
        path.join(rootDir, ".reposherlock-try-run-policy.json"),
      ];

  for (const candidate of candidatePaths) {
    const raw = await readPolicyFile(candidate);
    if (!raw) {
      continue;
    }

    return mergePolicy(defaults, raw, candidate);
  }

  return defaults;
}

function defaultPolicy(): TryRunPolicy {
  return {
    source: "default",
    scriptPriority: [...DEFAULT_SCRIPT_PRIORITY],
    allowedCommands: [...DEFAULT_ALLOWED_COMMANDS],
    allowedScriptEntrypoints: [...DEFAULT_ALLOWED_SCRIPT_ENTRYPOINTS],
    blockedScriptEntrypoints: [...DEFAULT_BLOCKED_SCRIPT_ENTRYPOINTS],
  };
}

export function createDefaultTryRunPolicy(): TryRunPolicy {
  return defaultPolicy();
}

function resolvePolicyPath(rootDir: string, overridePath: string): string {
  if (path.isAbsolute(overridePath)) {
    return overridePath;
  }
  return path.resolve(rootDir, overridePath);
}

async function readPolicyFile(filePath: string): Promise<RawTryRunPolicy | null> {
  const text = await fs.readFile(filePath, "utf8").catch(() => "");
  if (!text.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as RawTryRunPolicy;
    return parsed;
  } catch (error) {
    throw new Error(`Invalid try-run policy JSON at ${filePath}: ${String(error)}`);
  }
}

function mergePolicy(base: TryRunPolicy, raw: RawTryRunPolicy, source: string): TryRunPolicy {
  return {
    source,
    scriptPriority: pickStringArray(raw.scriptPriority, base.scriptPriority),
    allowedCommands: pickStringArray(raw.allowedCommands, base.allowedCommands),
    allowedScriptEntrypoints: pickStringArray(raw.allowedScriptEntrypoints, base.allowedScriptEntrypoints),
    blockedScriptEntrypoints: pickStringArray(raw.blockedScriptEntrypoints, base.blockedScriptEntrypoints),
  };
}

function pickStringArray(candidate: unknown, fallback: string[]): string[] {
  if (!Array.isArray(candidate)) {
    return [...fallback];
  }

  const cleaned = candidate
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (cleaned.length === 0) {
    return [...fallback];
  }

  return Array.from(new Set(cleaned));
}
