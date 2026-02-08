import path from "node:path";
import type {
  DeterministicSummary,
  FileIndexEntry,
  KeyFiles,
  LlmConfig,
  LlmPromptPack,
  RiskItem,
  SafeLlmFileExcerpt,
} from "../types.js";
import { readTextFileLimited } from "../utils/fs.js";

const SECRET_LIKE_REGEXES = [
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bsk-[A-Za-z0-9]{20,}\b/g,
  /-----BEGIN (?:RSA|OPENSSH|EC|DSA|PGP) PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+-----/g,
  /(api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9_\-\/.+=]{8,}["']?/gi,
];

const PREFERRED_EXCERPTS = [
  "readme",
  "package.json",
  "dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  ".env.example",
  "requirements.txt",
  "pyproject.toml",
  "makefile",
];

export async function buildSafePromptPack(input: {
  rootDir: string;
  fileIndex: FileIndexEntry[];
  keyFiles: KeyFiles;
  summary: DeterministicSummary;
  risks: RiskItem[];
  config: LlmConfig;
}): Promise<LlmPromptPack> {
  const safeSummary = stripSecretRisks(input.summary, input.risks);
  const summaryJson = JSON.stringify(safeSummary, null, 2);
  const excerpts: SafeLlmFileExcerpt[] = [];
  const droppedFiles: string[] = [];

  let remainingBudget = Math.max(0, input.config.maxChars - summaryJson.length);

  const candidates = selectExcerptCandidates(input.fileIndex, input.keyFiles);
  for (const relPath of candidates) {
    if (remainingBudget <= 0) {
      droppedFiles.push(relPath);
      continue;
    }

    const absPath = path.join(input.rootDir, relPath);
    const { text, truncated } = await readTextFileLimited(absPath, input.config.perFileChars).catch(() => ({
      text: "",
      truncated: false,
    }));

    if (!text) {
      continue;
    }

    const sanitized = removeSecretLikeContent(text);
    if (!sanitized.trim()) {
      droppedFiles.push(relPath);
      continue;
    }

    const contentBudget = Math.min(remainingBudget, input.config.perFileChars);
    const clipped = sanitized.slice(0, contentBudget);
    if (!clipped) {
      droppedFiles.push(relPath);
      continue;
    }

    excerpts.push({
      file: relPath,
      content: clipped,
      truncated: truncated || sanitized.length > clipped.length,
    });

    remainingBudget -= clipped.length;
  }

  return {
    disclaimer: "LLM-assisted text generation enabled; verify instructions.",
    summaryJson,
    excerpts,
    totalChars: summaryJson.length + excerpts.reduce((acc, item) => acc + item.content.length, 0),
    droppedFiles,
  };
}

function selectExcerptCandidates(fileIndex: FileIndexEntry[], keyFiles: KeyFiles): string[] {
  const set = new Set<string>();

  for (const file of keyFiles.readmeFiles.slice(0, 2)) set.add(file);
  if (keyFiles.packageJson) set.add(keyFiles.packageJson);
  if (keyFiles.dockerfile) set.add(keyFiles.dockerfile);
  if (keyFiles.dockerCompose) set.add(keyFiles.dockerCompose);
  if (keyFiles.envExample) set.add(keyFiles.envExample);
  if (keyFiles.requirementsTxt) set.add(keyFiles.requirementsTxt);
  if (keyFiles.pyprojectToml) set.add(keyFiles.pyprojectToml);
  if (keyFiles.makefile) set.add(keyFiles.makefile);

  for (const entrypoint of keyFiles.entrypoints.slice(0, 5)) {
    set.add(entrypoint);
  }

  const sortedByPreference = fileIndex
    .map((file) => file.relPath)
    .sort((a, b) => preferenceScore(a) - preferenceScore(b) || a.localeCompare(b));

  for (const rel of sortedByPreference) {
    if (set.size >= 20) {
      break;
    }
    const lower = rel.toLowerCase();
    if (
      lower.includes("readme") ||
      lower.endsWith("package.json") ||
      lower.endsWith("dockerfile") ||
      lower.endsWith("docker-compose.yml") ||
      lower.endsWith("docker-compose.yaml") ||
      lower.endsWith(".env.example")
    ) {
      set.add(rel);
    }
  }

  return Array.from(set);
}

function preferenceScore(relPath: string): number {
  const lower = relPath.toLowerCase();
  const idx = PREFERRED_EXCERPTS.findIndex((token) => lower.includes(token));
  return idx === -1 ? 999 : idx;
}

function stripSecretRisks(summary: DeterministicSummary, risks: RiskItem[]): DeterministicSummary {
  const safeRisks = risks.filter((risk) => risk.category !== "secret");
  return {
    ...summary,
    risks: safeRisks,
    issues: summary.issues.filter((issue) => !issue.labels.some((label) => label.includes("category:secret"))),
  };
}

export function removeSecretLikeContent(content: string): string {
  let sanitized = content;
  for (const regex of SECRET_LIKE_REGEXES) {
    sanitized = sanitized.replace(regex, "[REMOVED_SECRET]");
  }

  const lines = sanitized.split(/\r?\n/).filter((line) => !line.includes("[REMOVED_SECRET]"));
  return lines.join("\n");
}
