export interface GitHubRepoRef {
  owner: string;
  repo: string;
  normalizedUrl: string;
}

export function parseGitHubRepoUrl(input: string): GitHubRepoRef | null {
  const normalized = normalizeGitHubUrlInput(input);
  if (!normalized) {
    return null;
  }

  try {
    const url = new URL(normalized);
    const host = url.hostname.toLowerCase();
    if (host !== "github.com" && host !== "www.github.com") {
      return null;
    }
    const [ownerRaw, repoRaw] = url.pathname.split("/").filter(Boolean);
    if (!ownerRaw || !repoRaw) {
      return null;
    }

    const owner = ownerRaw.trim();
    if (!isValidGitHubName(owner)) {
      return null;
    }

    const repoName = repoRaw.endsWith(".git") ? repoRaw.slice(0, -4) : repoRaw;
    const repo = repoName.trim();
    if (!repo || !isValidGitHubName(repo)) {
      return null;
    }

    return {
      owner,
      repo,
      normalizedUrl: canonicalRepoUrl(owner, repo),
    };
  } catch {
    return null;
  }
}

export function validateGitHubRepoUrlOrThrow(input: string): GitHubRepoRef {
  const parsed = parseGitHubRepoUrl(input);
  if (!parsed) {
    throw new Error(
      `Invalid repository URL: '${input}'. Use a GitHub repo URL like https://github.com/owner/repo`,
    );
  }
  return parsed;
}

export function canonicalRepoUrl(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}`;
}

function normalizeGitHubUrlInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (/^github\.com\//i.test(trimmed) || /^www\.github\.com\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return null;
}

function isValidGitHubName(value: string): boolean {
  if (!value || value.length > 100) {
    return false;
  }
  return /^[A-Za-z0-9._-]+$/.test(value);
}

export function githubDisplayName(ref: GitHubRepoRef): string {
  return `${ref.owner}/${ref.repo}`;
}

export function toGitCloneUrl(ref: GitHubRepoRef): string {
  return `https://github.com/${ref.owner}/${ref.repo}.git`;
}

export function toGitHubArchiveApiRepo(ref: GitHubRepoRef): { owner: string; repo: string } {
  return { owner: ref.owner, repo: ref.repo };
}

export function toNormalizedRepoUrl(ref: GitHubRepoRef): string {
  return ref.normalizedUrl;
}

export function isGitHubRepoUrl(input: string): boolean {
  return Boolean(parseGitHubRepoUrl(input));
}
