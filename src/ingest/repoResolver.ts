import fs from "node:fs/promises";
import path from "node:path";
import { execWithLimit } from "../utils/exec.js";
import { fileExists, isDirectory, ensureDir, commandExists } from "../utils/fs.js";
import { sha1 } from "../utils/hash.js";
import {
  githubDisplayName,
  parseGitHubRepoUrl,
  toGitCloneUrl,
  toNormalizedRepoUrl,
} from "./github.js";
import type { RepoIdentity } from "../types.js";

export interface ResolveRepoInput {
  input: string;
  workspaceRoot: string;
  noNetwork: boolean;
}

export async function resolveRepo(input: ResolveRepoInput): Promise<RepoIdentity> {
  const maybeLocal = path.resolve(input.workspaceRoot, input.input);
  if (await isDirectory(maybeLocal)) {
    return {
      input: input.input,
      resolvedPath: maybeLocal,
      displayName: path.basename(maybeLocal),
      sourceType: "local",
    };
  }

  const ref = parseGitHubRepoUrl(input.input);
  if (!ref) {
    throw new Error(`Input is neither a local directory nor a supported GitHub URL: ${input.input}`);
  }

  if (input.noNetwork) {
    throw new Error("--no-network is enabled; remote repositories are not allowed");
  }

  const normalizedRepoUrl = toNormalizedRepoUrl(ref);
  const cacheKey = sha1(normalizedRepoUrl);
  const repoCacheRoot = path.join(input.workspaceRoot, ".reposherlock", "repos");
  const checkoutPath = path.join(repoCacheRoot, cacheKey);
  await ensureDir(repoCacheRoot);

  if (await isDirectory(checkoutPath)) {
    return {
      input: normalizedRepoUrl,
      resolvedPath: checkoutPath,
      displayName: githubDisplayName(ref),
      sourceType: "github-clone",
    };
  }

  if (await commandExists("git")) {
    const result = await execWithLimit(
      "git",
      ["clone", "--depth", "1", toGitCloneUrl(ref), checkoutPath],
      {
        cwd: input.workspaceRoot,
        timeoutMs: 180_000,
        maxOutputChars: 200_000,
      },
    );

    if (result.exitCode === 0) {
      const commit = await readHeadCommit(checkoutPath);
      return {
        input: normalizedRepoUrl,
        resolvedPath: checkoutPath,
        displayName: githubDisplayName(ref),
        sourceType: "github-clone",
        commitOrRef: commit || undefined,
      };
    }

    await fs.rm(checkoutPath, { recursive: true, force: true }).catch(() => undefined);
  }

  const downloaded = await downloadGitHubArchive(ref.owner, ref.repo, checkoutPath, input.workspaceRoot);
  return {
    input: normalizedRepoUrl,
    resolvedPath: downloaded,
    displayName: githubDisplayName(ref),
    sourceType: "github-zip",
  };
}

async function readHeadCommit(repoPath: string): Promise<string | null> {
  const result = await execWithLimit("git", ["rev-parse", "HEAD"], {
    cwd: repoPath,
    timeoutMs: 15_000,
    maxOutputChars: 2048,
  });
  if (result.exitCode !== 0) {
    return null;
  }
  return result.stdout.trim() || null;
}

async function downloadGitHubArchive(
  owner: string,
  repo: string,
  targetDir: string,
  workspaceRoot: string,
): Promise<string> {
  const metaUrl = `https://api.github.com/repos/${owner}/${repo}`;
  const metaRes = await fetch(metaUrl, {
    headers: {
      "User-Agent": "RepoSherlock",
      Accept: "application/vnd.github+json",
    },
  });

  if (!metaRes.ok) {
    throw new Error(`Failed to fetch GitHub metadata (${metaRes.status})`);
  }

  const meta = (await metaRes.json()) as { default_branch?: string };
  const branch = meta.default_branch || "main";

  const archiveUrl = `https://codeload.github.com/${owner}/${repo}/tar.gz/refs/heads/${branch}`;
  const archiveRes = await fetch(archiveUrl, {
    headers: { "User-Agent": "RepoSherlock" },
  });
  if (!archiveRes.ok || !archiveRes.body) {
    throw new Error(`Failed to download repository archive (${archiveRes.status})`);
  }

  const tarPath = path.join(workspaceRoot, ".reposherlock", "repos", `${sha1(archiveUrl)}.tar.gz`);
  await ensureDir(path.dirname(tarPath));
  const buffer = Buffer.from(await archiveRes.arrayBuffer());
  await fs.writeFile(tarPath, buffer);

  await ensureDir(targetDir);
  const extractResult = await execWithLimit("tar", ["-xzf", tarPath, "-C", targetDir, "--strip-components", "1"], {
    cwd: workspaceRoot,
    timeoutMs: 180_000,
    maxOutputChars: 60_000,
  });

  if (extractResult.exitCode !== 0) {
    throw new Error(`Failed to extract repository archive: ${extractResult.stderr || "unknown error"}`);
  }

  await fs.unlink(tarPath).catch(() => undefined);
  return targetDir;
}

export async function validateAnalysisTarget(targetPath: string): Promise<void> {
  if (!(await fileExists(targetPath))) {
    throw new Error(`Target path does not exist: ${targetPath}`);
  }
}
