import fs from "node:fs/promises";
import path from "node:path";
import type { FileIndexEntry, RiskItem } from "../types.js";
import { readTextFileLimited } from "../utils/fs.js";

interface SecretPattern {
  id: string;
  title: string;
  regex: RegExp;
  severity: "low" | "med" | "high";
  confidence: number;
}

interface SecretAllowlist {
  literals: string[];
  regexes: RegExp[];
}

const SECRET_PATTERNS: SecretPattern[] = [
  {
    id: "secret-aws-access-key",
    title: "Potential AWS access key",
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    severity: "high",
    confidence: 0.98,
  },
  {
    id: "secret-private-key",
    title: "Private key block detected",
    regex: /-----BEGIN (?:RSA|OPENSSH|EC|DSA|PGP) PRIVATE KEY-----/g,
    severity: "high",
    confidence: 0.99,
  },
  {
    id: "secret-github-token",
    title: "Potential GitHub token",
    regex: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
    severity: "high",
    confidence: 0.95,
  },
  {
    id: "secret-openai-key",
    title: "Potential OpenAI API key",
    regex: /\bsk-[A-Za-z0-9]{20,}\b/g,
    severity: "high",
    confidence: 0.95,
  },
  {
    id: "secret-generic-assignment",
    title: "Potential API key/token assignment",
    regex:
      /\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*["']?([^\s"']{8,})["']?/gi,
    severity: "med",
    confidence: 0.7,
  },
];

const MAX_SCAN_BYTES = 1_000_000;
const SAMPLE_PATH_HINT = /(\/|^)(test|tests|fixture|fixtures|example|examples|sample|samples|mock|mocks)(\/|$)/i;

export interface SecretScanResult {
  risks: RiskItem[];
  findingsCount: number;
}

export function redactSecret(raw: string): string {
  const compact = raw.trim();
  if (compact.length <= 8) {
    return "[REDACTED]";
  }
  return `${compact.slice(0, 4)}...[REDACTED]...${compact.slice(-2)}`;
}

export async function scanSecrets(
  rootDir: string,
  index: FileIndexEntry[],
  redactSecrets = true,
): Promise<SecretScanResult> {
  const risks: RiskItem[] = [];
  let findingsCount = 0;
  const allowlist = await loadSecretAllowlist(rootDir);

  for (const file of index) {
    if (file.isBinary || file.sizeBytes > MAX_SCAN_BYTES) {
      continue;
    }

    const lower = file.relPath.toLowerCase();
    if (lower.includes("node_modules/") || lower.includes("dist/")) {
      continue;
    }

    const abs = path.join(rootDir, file.relPath);
    const { text } = await readTextFileLimited(abs, MAX_SCAN_BYTES).catch(() => ({ text: "", truncated: false }));
    if (!text) {
      continue;
    }

    for (const pattern of SECRET_PATTERNS) {
      let match: RegExpExecArray | null;
      let matchCount = 0;
      while ((match = pattern.regex.exec(text)) !== null) {
        const rawMatch = match[0];
        const token = extractCandidateToken(pattern.id, rawMatch, match);

        if (shouldSkipFinding(pattern.id, file.relPath, rawMatch, token, allowlist)) {
          continue;
        }

        matchCount += 1;
        findingsCount += 1;

        const display = redactSecrets ? redactSecret(token || rawMatch) : token || rawMatch;

        risks.push({
          id: `${pattern.id}-${file.relPath}-${match.index}`,
          category: "secret",
          severity: pattern.severity,
          confidence: adjustedConfidence(pattern.id, token, file.relPath, pattern.confidence),
          title: pattern.title,
          description: `Potential secret-like token found in ${file.relPath}.`,
          evidence: [`${file.relPath}:${display}`],
          redacted: redactSecrets,
        });

        if (matchCount >= 5) {
          break;
        }
      }
      pattern.regex.lastIndex = 0;
    }
  }

  return { risks, findingsCount };
}

async function loadSecretAllowlist(rootDir: string): Promise<SecretAllowlist> {
  const filePath = path.join(rootDir, ".reposherlock", "secret-allowlist.txt");
  const text = await fs.readFile(filePath, "utf8").catch(() => "");

  const literals: string[] = [];
  const regexes: RegExp[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    if (trimmed.startsWith("re:")) {
      const pattern = trimmed.slice(3).trim();
      if (!pattern) {
        continue;
      }

      try {
        regexes.push(new RegExp(pattern, "i"));
      } catch {
        // Invalid regex entries are ignored to avoid hard-failing scans.
      }
      continue;
    }

    literals.push(trimmed.toLowerCase());
  }

  return { literals, regexes };
}

function shouldSkipFinding(
  patternId: string,
  relPath: string,
  rawMatch: string,
  token: string | null,
  allowlist: SecretAllowlist,
): boolean {
  if (matchesAllowlist(relPath, rawMatch, token, allowlist)) {
    return true;
  }

  if (token && !isLikelyTokenShape(patternId, token)) {
    return true;
  }

  if (token && isLikelyPlaceholder(token)) {
    return true;
  }

  if (token && isLikelySyntheticSampleToken(patternId, relPath, token)) {
    return true;
  }

  if (patternId === "secret-generic-assignment") {
    if (!token || token.length < 12) {
      return true;
    }

    const entropy = shannonEntropy(token);
    const inSamplePath = SAMPLE_PATH_HINT.test(relPath);

    if (inSamplePath && entropy < 3.8) {
      return true;
    }

    if (entropy < 3.1) {
      return true;
    }
  }

  return false;
}

function matchesAllowlist(
  relPath: string,
  rawMatch: string,
  token: string | null,
  allowlist: SecretAllowlist,
): boolean {
  const hay = `${relPath}\n${rawMatch}\n${token || ""}`.toLowerCase();

  for (const literal of allowlist.literals) {
    if (hay.includes(literal)) {
      return true;
    }
  }

  for (const regex of allowlist.regexes) {
    if (regex.test(hay)) {
      return true;
    }
  }

  return false;
}

function extractCandidateToken(patternId: string, rawMatch: string, match: RegExpExecArray): string | null {
  if (patternId === "secret-generic-assignment") {
    const genericValue = match[2];
    if (genericValue) {
      return sanitizeToken(genericValue);
    }
  }

  const normalized = sanitizeToken(rawMatch);

  if (!normalized) {
    return null;
  }

  return normalized;
}

function adjustedConfidence(patternId: string, token: string | null, relPath: string, base: number): number {
  if (patternId !== "secret-generic-assignment" || !token) {
    return base;
  }

  const entropy = shannonEntropy(token);
  const inSamplePath = SAMPLE_PATH_HINT.test(relPath);

  if (entropy >= 4.2) {
    return Math.min(0.9, base + 0.15);
  }

  if (inSamplePath) {
    return Math.max(0.5, base - 0.1);
  }

  return base;
}

function isLikelyPlaceholder(value: string): boolean {
  const lower = value.toLowerCase();
  if (
    lower.includes("example") ||
    lower.includes("sample") ||
    lower.includes("dummy") ||
    lower.includes("changeme") ||
    lower.includes("your_") ||
    lower.includes("your-") ||
    lower.includes("replace_me") ||
    lower.includes("replace-this") ||
    lower.includes("test") ||
    lower.includes("demo")
  ) {
    return true;
  }

  if (/^[x*#-]{8,}$/i.test(lower)) {
    return true;
  }

  if (/^(?:[0-9]{8,}|[a-f0-9]{16,})$/i.test(lower)) {
    return true;
  }

  if (/^[a-z]+$/.test(lower) && lower.length > 12) {
    return true;
  }

  return false;
}

function sanitizeToken(value: string): string {
  return value
    .replace(/^['"`]+|['"`]+$/g, "")
    .replace(/[),;]+$/g, "")
    .trim();
}

function isLikelyTokenShape(patternId: string, value: string): boolean {
  if (!value || value.length < 8) {
    return false;
  }

  if (value.includes("\\n") || value.includes("${") || /[(){}[\],;]/.test(value)) {
    return false;
  }

  if (patternId === "secret-generic-assignment") {
    if (!/^[A-Za-z0-9._~+/\-=:]{8,}$/.test(value)) {
      return false;
    }

    if (/^[A-Z][A-Z0-9_]{6,}$/.test(value)) {
      return false;
    }

    if (/^(?:process\.env|import\.meta\.env)\./i.test(value)) {
      return false;
    }
  }

  return true;
}

function isLikelySyntheticSampleToken(patternId: string, relPath: string, token: string): boolean {
  if (!SAMPLE_PATH_HINT.test(relPath)) {
    return false;
  }

  if (patternId === "secret-private-key") {
    return false;
  }

  const lower = token.toLowerCase();
  if (
    lower.includes("123456") ||
    lower.includes("abcdef") ||
    lower.includes("qwerty") ||
    lower.includes("asdf") ||
    lower.includes("000000") ||
    lower.includes("111111")
  ) {
    return true;
  }

  return false;
}

function shannonEntropy(value: string): number {
  if (!value) {
    return 0;
  }

  const chars = new Map<string, number>();
  for (const ch of value) {
    chars.set(ch, (chars.get(ch) || 0) + 1);
  }

  let entropy = 0;
  for (const count of chars.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}
