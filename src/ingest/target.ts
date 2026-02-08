import fs from "node:fs";
import path from "node:path";
import { isGitHubRepoUrl } from "./github.js";

export type RepoTargetKind = "github-url" | "local-path";

export interface RepoTargetValidation {
  kind: RepoTargetKind;
  normalizedInput: string;
  resolvedLocalPath?: string;
}

export function isLocalDirectoryTarget(input: string, workspaceRoot = process.cwd()): boolean {
  const resolved = resolveLocalDirectoryTarget(input, workspaceRoot);
  return resolved !== null;
}

export function isSupportedRepoTarget(input: string, workspaceRoot = process.cwd()): boolean {
  const normalized = normalizeTargetInput(input);
  if (!normalized) {
    return false;
  }
  return isGitHubRepoUrl(normalized) || isLocalDirectoryTarget(normalized, workspaceRoot);
}

export function validateRepoTargetOrThrow(
  input: string,
  workspaceRoot = process.cwd(),
): RepoTargetValidation {
  const normalized = normalizeTargetInput(input);
  if (!normalized) {
    throw new Error("Target cannot be empty. Use a GitHub repo URL or existing local directory path.");
  }

  if (isGitHubRepoUrl(normalized)) {
    return {
      kind: "github-url",
      normalizedInput: normalized,
    };
  }

  const localPath = resolveLocalDirectoryTarget(normalized, workspaceRoot);
  if (localPath) {
    return {
      kind: "local-path",
      normalizedInput: normalized,
      resolvedLocalPath: localPath,
    };
  }

  throw new Error(
    `Invalid target: '${input}'. Use a GitHub repo URL like https://github.com/owner/repo or an existing local directory path.`,
  );
}

function resolveLocalDirectoryTarget(input: string, workspaceRoot: string): string | null {
  const normalized = normalizeTargetInput(input);
  if (!normalized) {
    return null;
  }

  const resolved = path.resolve(workspaceRoot, normalized);
  try {
    const stat = fs.statSync(resolved);
    return stat.isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

function normalizeTargetInput(input: string): string {
  return input.trim();
}
