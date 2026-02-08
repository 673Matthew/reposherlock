import path from "node:path";
import type {
  EnvAnalysis,
  EvidenceRef,
  FileIndexEntry,
  KeyFiles,
  LanguageBreakdown,
  ProjectClassification,
  RunGuess,
  SummaryEvidence,
} from "../types.js";
import { readTextFileLimited } from "../utils/fs.js";

export interface UnderstandResult {
  classification: ProjectClassification;
  runGuess: RunGuess;
  likelyPurpose: string;
  envHints: string[];
  envAnalysis: EnvAnalysis;
  evidence: Omit<SummaryEvidence, "architecture">;
}

interface PackageJsonLite {
  name?: string;
  description?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  bin?: string | Record<string, string>;
}

interface PurposeGuess {
  text: string;
  evidence: EvidenceRef[];
}

interface RunGuessWithEvidence {
  runGuess: RunGuess;
  evidence: EvidenceRef[];
}

const GENERIC_ENV_NAMES = new Set([
  "PATH",
  "HOME",
  "PWD",
  "OLDPWD",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_COLLATE",
  "USER",
  "USERNAME",
  "LOGNAME",
  "HOSTNAME",
  "TMP",
  "TMPDIR",
  "TEMP",
  "SHLVL",
  "INIT_CWD",
  "NODE_ENV",
  "PORT",
  "HOST",
  "TZ",
  "CI",
  "GITHUB_ACTIONS",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "XDG_RUNTIME_DIR",
]);

const ENV_CODE_PATTERNS: Array<{ regex: RegExp; source: string }> = [
  { regex: /process\.env\.([A-Z][A-Z0-9_]{1,})/g, source: "Node env access" },
  { regex: /process\.env\[['"]([A-Z][A-Z0-9_]{1,})['"]\]/g, source: "Node env access" },
  { regex: /import\.meta\.env\.([A-Z][A-Z0-9_]{1,})/g, source: "Frontend env access" },
  { regex: /os\.environ\.get\(\s*['"]([A-Z][A-Z0-9_]{1,})['"]/g, source: "Python env access" },
  { regex: /os\.getenv\(\s*['"]([A-Z][A-Z0-9_]{1,})['"]/g, source: "Python env access" },
];

const ENV_SCAN_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".sh"]);

export async function runUnderstandStage(
  rootDir: string,
  fileIndex: FileIndexEntry[],
  keyFiles: KeyFiles,
  languageBreakdown: LanguageBreakdown[],
): Promise<UnderstandResult> {
  const packageJson = await loadPackageJson(rootDir, keyFiles.packageJson);
  const classification = classifyProject(keyFiles, languageBreakdown, packageJson);
  const runGuessWithEvidence = buildRunGuess(keyFiles, packageJson, classification.runtime);
  const purposeGuess = await describeLikelyPurpose(rootDir, keyFiles, packageJson, classification);
  const envAnalysis = await detectEnvHints(rootDir, fileIndex, keyFiles);
  const envHints = [
    ...envAnalysis.required.map((item) => item.name),
    ...envAnalysis.optional.map((item) => item.name),
    ...envAnalysis.mentioned.map((item) => item.name),
  ];

  const classificationEvidence = buildClassificationEvidence(classification, keyFiles, packageJson, languageBreakdown);
  const envEvidence = collectEnvEvidence(envAnalysis);

  return {
    classification,
    runGuess: runGuessWithEvidence.runGuess,
    likelyPurpose: purposeGuess.text,
    envHints,
    envAnalysis,
    evidence: {
      classification: classificationEvidence,
      purpose: purposeGuess.evidence,
      run: runGuessWithEvidence.evidence,
      env: envEvidence,
    },
  };
}

async function loadPackageJson(rootDir: string, packageRel?: string): Promise<PackageJsonLite | null> {
  if (!packageRel) {
    return null;
  }

  const abs = path.join(rootDir, packageRel);
  const { text } = await readTextFileLimited(abs, 500_000).catch(() => ({ text: "", truncated: false }));
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as PackageJsonLite;
  } catch {
    return null;
  }
}

function classifyProject(
  keyFiles: KeyFiles,
  languageBreakdown: LanguageBreakdown[],
  packageJson: PackageJsonLite | null,
): ProjectClassification {
  const deps = { ...(packageJson?.dependencies || {}), ...(packageJson?.devDependencies || {}) };
  const scripts = packageJson?.scripts || {};

  let runtime: ProjectClassification["runtime"] = "other";
  if (keyFiles.packageJson) {
    runtime = keyFiles.bunLock ? "bun" : "node";
  } else if (keyFiles.requirementsTxt || keyFiles.pyprojectToml) {
    runtime = "python";
  } else if (languageBreakdown[0]?.language === "Go") {
    runtime = "go";
  } else if (languageBreakdown[0]?.language === "Rust") {
    runtime = "rust";
  }

  let frameworkGuess: string | null = null;
  if (deps.next) frameworkGuess = "next";
  else if (deps.react) frameworkGuess = "react";
  else if (deps.vue) frameworkGuess = "vue";
  else if (deps.svelte) frameworkGuess = "svelte";
  else if (deps.express) frameworkGuess = "express";
  else if (deps.fastify) frameworkGuess = "fastify";
  else if (deps["@nestjs/core"]) frameworkGuess = "nestjs";
  else if (deps.fastapi) frameworkGuess = "fastapi";
  else if (deps.flask) frameworkGuess = "flask";
  else if (deps.django) frameworkGuess = "django";

  let projectType: ProjectClassification["projectType"] = "unknown";
  if (packageJson?.bin || scripts.start || scripts.dev) {
    projectType = scripts.start || scripts.dev ? "app" : "cli";
  }

  if (frameworkGuess === "next" || frameworkGuess === "react" || frameworkGuess === "vue" || frameworkGuess === "svelte") {
    projectType = "web";
  }

  if (["express", "fastify", "nestjs", "fastapi", "flask", "django"].includes(frameworkGuess || "")) {
    projectType = "service";
  }

  const hasIndexEntrypoint = keyFiles.entrypoints.length > 0;
  if (projectType === "unknown" && hasIndexEntrypoint) {
    projectType = "app";
  }

  if (projectType === "unknown") {
    const hasPublishedSignals = Boolean(packageJson?.name && !scripts.start && !scripts.dev);
    projectType = hasPublishedSignals ? "library" : "unknown";
  }

  const confidence = frameworkGuess ? 0.82 : hasIndexEntrypoint ? 0.65 : 0.45;

  return {
    projectType,
    runtime,
    frameworkGuess,
    confidence,
  };
}

function buildRunGuess(
  keyFiles: KeyFiles,
  packageJson: PackageJsonLite | null,
  runtime: ProjectClassification["runtime"],
): RunGuessWithEvidence {
  const scripts = packageJson?.scripts || {};
  const installCommands: string[] = [];
  const runCommands: string[] = [];
  const testCommands: string[] = [];
  const evidence: EvidenceRef[] = [];

  if (runtime === "bun") {
    installCommands.push("bun install");
    if (keyFiles.packageJson) {
      evidence.push({
        source: "package.json + bun lock",
        path: keyFiles.packageJson,
        snippet: "bun runtime inferred because bun lockfile exists.",
      });
    }
    for (const scriptName of ["dev", "start", "build"]) {
      if (scripts[scriptName]) {
        runCommands.push(`bun run ${scriptName}`);
        evidence.push({
          source: "package.json scripts",
          path: keyFiles.packageJson || "package.json",
          snippet: `scripts.${scriptName}: ${scripts[scriptName].slice(0, 140)}`,
        });
      }
    }
    if (scripts.test) {
      testCommands.push("bun run test");
      evidence.push({
        source: "package.json scripts",
        path: keyFiles.packageJson || "package.json",
        snippet: `scripts.test: ${scripts.test.slice(0, 140)}`,
      });
    }
  } else if (runtime === "node") {
    installCommands.push("npm ci");
    for (const scriptName of ["dev", "start", "build"]) {
      if (scripts[scriptName]) {
        runCommands.push(`npm run ${scriptName}`);
        evidence.push({
          source: "package.json scripts",
          path: keyFiles.packageJson || "package.json",
          snippet: `scripts.${scriptName}: ${scripts[scriptName].slice(0, 140)}`,
        });
      }
    }
    if (scripts.test) {
      testCommands.push("npm run test");
      evidence.push({
        source: "package.json scripts",
        path: keyFiles.packageJson || "package.json",
        snippet: `scripts.test: ${scripts.test.slice(0, 140)}`,
      });
    }
  } else if (runtime === "python") {
    if (keyFiles.requirementsTxt) {
      installCommands.push("python -m pip install -r requirements.txt");
      evidence.push({
        source: "requirements file",
        path: keyFiles.requirementsTxt,
        snippet: "requirements.txt detected.",
      });
    }
    if (keyFiles.pyprojectToml) {
      installCommands.push("python -m pip install -e .");
      evidence.push({
        source: "pyproject",
        path: keyFiles.pyprojectToml,
        snippet: "pyproject.toml detected.",
      });
    }
    if (keyFiles.entrypoints.length > 0) {
      runCommands.push(`python ${keyFiles.entrypoints[0]}`);
      evidence.push({
        source: "entrypoint heuristic",
        path: keyFiles.entrypoints[0],
        snippet: "Detected as a likely runnable entrypoint by filename pattern.",
      });
    }
    testCommands.push("pytest");
  }

  if (keyFiles.dockerCompose) {
    runCommands.unshift("docker compose up --build");
    evidence.push({
      source: "docker compose",
      path: keyFiles.dockerCompose,
      snippet: "docker-compose file detected.",
    });
  } else if (keyFiles.dockerfile) {
    runCommands.unshift("docker build -t reposherlock-target . && docker run --rm reposherlock-target");
    evidence.push({
      source: "dockerfile",
      path: keyFiles.dockerfile,
      snippet: "Dockerfile detected.",
    });
  }

  if (runCommands.length === 0 && keyFiles.makefile) {
    runCommands.push("make run");
    evidence.push({
      source: "makefile",
      path: keyFiles.makefile,
      snippet: "Fallback run guess from Makefile presence.",
    });
  }

  const configHints: string[] = [];
  if (!keyFiles.envExample) {
    configHints.push("No .env.example found; inspect README and source for required env vars.");
  } else {
    configHints.push(`Review ${keyFiles.envExample} for required environment variables.`);
  }

  return {
    runGuess: {
      installCommands,
      runCommands,
      testCommands,
      configHints,
    },
    evidence: dedupeEvidence(evidence),
  };
}

async function describeLikelyPurpose(
  rootDir: string,
  keyFiles: KeyFiles,
  packageJson: PackageJsonLite | null,
  classification: ProjectClassification,
): Promise<PurposeGuess> {
  if (packageJson?.description?.trim()) {
    return {
      text: packageJson.description.trim(),
      evidence: [
        {
          source: "package.json description",
          path: keyFiles.packageJson || "package.json",
          snippet: packageJson.description.trim().slice(0, 180),
        },
      ],
    };
  }

  const readmePurpose = await extractPurposeFromReadme(rootDir, keyFiles);
  if (readmePurpose) {
    return readmePurpose;
  }

  const framework = classification.frameworkGuess ? ` using ${classification.frameworkGuess}` : "";
  if (classification.projectType !== "unknown") {
    return {
      text: `This appears to be a ${classification.projectType} project${framework}.`,
      evidence: [
        {
          source: "classification heuristic",
          path: keyFiles.packageJson || keyFiles.readmeFiles[0] || "repository-root",
          snippet: `projectType=${classification.projectType}, runtime=${classification.runtime}, framework=${classification.frameworkGuess || "unknown"}`,
        },
      ],
    };
  }

  return {
    text: "Repo purpose is inferred heuristically from repository structure and may be incomplete.",
    evidence: [],
  };
}

async function extractPurposeFromReadme(rootDir: string, keyFiles: KeyFiles): Promise<PurposeGuess | null> {
  const readme = keyFiles.readmeFiles[0];
  if (!readme) {
    return null;
  }

  const { text } = await readTextFileLimited(path.join(rootDir, readme), 40_000).catch(() => ({
    text: "",
    truncated: false,
  }));

  if (!text) {
    return null;
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates = lines.filter((line) => {
    if (line.startsWith("#")) return false;
    if (line.startsWith("![")) return false;
    if (line.startsWith("[![")) return false;
    if (line.startsWith("```")) return false;
    if (line.startsWith("<")) return false;
    if (line.startsWith("[")) return false;
    if (/^[-*]\s/.test(line)) return false;
    return line.length >= 24;
  });

  if (candidates.length === 0) {
    return null;
  }

  return {
    text: candidates[0].slice(0, 260),
    evidence: [
      {
        source: "README excerpt",
        path: readme,
        snippet: candidates[0].slice(0, 180),
      },
    ],
  };
}

async function detectEnvHints(rootDir: string, fileIndex: FileIndexEntry[], keyFiles: KeyFiles): Promise<EnvAnalysis> {
  const required = new Map<string, { evidence: EvidenceRef[] }>();
  const optional = new Map<string, { evidence: EvidenceRef[] }>();
  const mentioned = new Map<string, { evidence: EvidenceRef[] }>();
  const filteredOut: string[] = [];

  if (keyFiles.envExample) {
    const { text: envText } = await readTextFileLimited(path.join(rootDir, keyFiles.envExample), 150_000).catch(() => ({
      text: "",
      truncated: false,
    }));
    for (const line of envText.split(/\r?\n/)) {
      const clean = line.trim();
      if (!clean || clean.startsWith("#")) {
        continue;
      }
      const [key] = clean.split("=");
      if (key && /^[A-Z0-9_]+$/.test(key.trim())) {
        addEnvEvidence(required, key.trim(), {
          source: ".env example",
          path: keyFiles.envExample,
          snippet: clean.slice(0, 160),
        });
      }
    }
  }

  for (const file of fileIndex) {
    if (!ENV_SCAN_EXTS.has(file.ext)) {
      continue;
    }
    if (isAuxiliaryPath(file.relPath)) {
      continue;
    }

    const abs = path.join(rootDir, file.relPath);
    const { text } = await readTextFileLimited(abs, 80_000).catch(() => ({ text: "", truncated: false }));
    if (!text) {
      continue;
    }

    for (const pattern of ENV_CODE_PATTERNS) {
      let match: RegExpExecArray | null;
      while ((match = pattern.regex.exec(text)) !== null) {
        const name = match[1];
        if (!name) {
          continue;
        }
        const ev: EvidenceRef = {
          source: pattern.source,
          path: file.relPath,
          snippet: extractLineSnippet(text, match.index),
        };
        if (required.has(name)) {
          addEnvEvidence(required, name, ev);
        } else if (looksOptionalEnvUsage(ev.snippet, pattern.source)) {
          addEnvEvidence(optional, name, ev);
        } else {
          addEnvEvidence(required, name, ev);
        }
      }
      pattern.regex.lastIndex = 0;
    }
  }

  const readmeMentions = await detectReadmeEnvMentions(rootDir, keyFiles);
  for (const item of readmeMentions) {
    if (required.has(item.name)) {
      addManyEnvEvidence(required, item.name, item.evidence);
      continue;
    }
    if (optional.has(item.name)) {
      addManyEnvEvidence(optional, item.name, item.evidence);
      continue;
    }
    addManyEnvEvidence(mentioned, item.name, item.evidence);
  }

  for (const [name, entry] of required.entries()) {
    if (shouldFilterGenericEnv(name)) {
      filteredOut.push(name);
      required.delete(name);
      continue;
    }
    if (
      looksOptionalByEvidence(entry.evidence) &&
      !entry.evidence.some((evidence) => evidence.source.toLowerCase() === ".env example")
    ) {
      addManyEnvEvidence(optional, name, entry.evidence);
      required.delete(name);
    }
  }

  for (const [name, entry] of optional.entries()) {
    if (required.has(name)) {
      addManyEnvEvidence(required, name, entry.evidence);
      optional.delete(name);
      continue;
    }
    if (shouldFilterGenericEnv(name)) {
      filteredOut.push(name);
      optional.delete(name);
    }
  }

  for (const [name] of mentioned.entries()) {
    if (shouldFilterGenericEnv(name)) {
      filteredOut.push(name);
      mentioned.delete(name);
    }
  }

  const requiredHints = toHintArray(required, 0.88);
  const optionalHints = toHintArray(optional, 0.62);
  const mentionedHints = toHintArray(mentioned, 0.55);

  return {
    required: requiredHints,
    requiredByFlags: [],
    optional: optionalHints,
    mentioned: mentionedHints,
    filteredOut: Array.from(new Set(filteredOut)).sort(),
  };
}

function buildClassificationEvidence(
  classification: ProjectClassification,
  keyFiles: KeyFiles,
  packageJson: PackageJsonLite | null,
  languageBreakdown: LanguageBreakdown[],
): EvidenceRef[] {
  const evidence: EvidenceRef[] = [];

  if (keyFiles.packageJson) {
    const scripts = Object.keys(packageJson?.scripts || {});
    evidence.push({
      source: "package.json presence",
      path: keyFiles.packageJson,
      snippet: scripts.length > 0 ? `scripts: ${scripts.slice(0, 6).join(", ")}` : "package.json detected",
    });
  }

  if (classification.frameworkGuess && keyFiles.packageJson) {
    evidence.push({
      source: "framework dependency signal",
      path: keyFiles.packageJson,
      snippet: `framework=${classification.frameworkGuess}`,
    });
  }

  if (keyFiles.bunLock) {
    evidence.push({
      source: "bun lockfile",
      path: keyFiles.bunLock,
      snippet: "bun lockfile indicates Bun runtime preference.",
    });
  } else if (keyFiles.requirementsTxt) {
    evidence.push({
      source: "python requirements",
      path: keyFiles.requirementsTxt,
      snippet: "requirements.txt detected.",
    });
  } else if (languageBreakdown[0]) {
    evidence.push({
      source: "language breakdown",
      path: "file_index.json",
      snippet: `top language: ${languageBreakdown[0].language}`,
    });
  }

  return dedupeEvidence(evidence);
}

function collectEnvEvidence(env: EnvAnalysis): EvidenceRef[] {
  const combined = [...env.required, ...env.optional, ...env.mentioned]
    .slice(0, 20)
    .flatMap((item) =>
      item.evidence.slice(0, 2).map((ev) => ({
        ...ev,
        snippet: `${item.name}: ${ev.snippet}`.slice(0, 180),
      })),
    );
  return dedupeEvidence(combined);
}

function addEnvEvidence(
  map: Map<string, { evidence: EvidenceRef[] }>,
  name: string,
  evidence: EvidenceRef,
): void {
  const entry = map.get(name) || { evidence: [] };
  const key = `${evidence.path}|${evidence.snippet}`;
  const has = entry.evidence.some((item) => `${item.path}|${item.snippet}` === key);
  if (!has) {
    entry.evidence.push(evidence);
  }
  map.set(name, entry);
}

function addManyEnvEvidence(
  map: Map<string, { evidence: EvidenceRef[] }>,
  name: string,
  evidences: EvidenceRef[],
): void {
  for (const evidence of evidences) {
    addEnvEvidence(map, name, evidence);
  }
}

function toHintArray(map: Map<string, { evidence: EvidenceRef[] }>, baseConfidence: number) {
  return Array.from(map.entries())
    .map(([name, value]) => ({
      name,
      confidence: confidenceFromEvidence(baseConfidence, value.evidence.length),
      evidence: value.evidence.slice(0, 4),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function confidenceFromEvidence(base: number, evidenceCount: number): number {
  if (evidenceCount <= 1) {
    return Number(base.toFixed(2));
  }
  const adjusted = Math.min(0.98, base + Math.min(5, evidenceCount - 1) * 0.05);
  return Number(adjusted.toFixed(2));
}

function shouldFilterGenericEnv(name: string): boolean {
  if (GENERIC_ENV_NAMES.has(name)) {
    return true;
  }
  if (/^(npm|NPM|BUN|YARN|PNPM)_/.test(name)) {
    return true;
  }
  if (/^[A-Z]{1,2}$/.test(name)) {
    return true;
  }
  return false;
}

function isAuxiliaryPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/").toLowerCase();
  return /(^|\/)(test|tests|__tests__|spec|specs|fixture|fixtures|example|examples)(\/|$)/.test(normalized);
}

function looksOptionalEnvUsage(line: string, source: string): boolean {
  const lower = line.toLowerCase();
  if (/process\.env\.[A-Z][A-Z0-9_]*\s*=/.test(line)) {
    return true;
  }
  if (/process\.env\[['"][A-Z][A-Z0-9_]*['"]\]\s*=/.test(line)) {
    return true;
  }
  if (/delete\s+process\.env\.[A-Z][A-Z0-9_]*/.test(line)) {
    return true;
  }
  if (/const\s+\w*env\w*\s*=\s*process\.env\.[A-Z][A-Z0-9_]*/i.test(line)) {
    return true;
  }
  if (/(\?\s*process\.env\.[A-Z][A-Z0-9_]*\s*:\s*undefined)/i.test(line)) {
    return true;
  }
  if (source.toLowerCase().includes("python") && /getenv\([^,]+,\s*['"]/.test(line)) {
    return true;
  }
  return lower.includes("||") || lower.includes("??") || lower.includes("default");
}

async function detectReadmeEnvMentions(
  rootDir: string,
  keyFiles: KeyFiles,
): Promise<Array<{ name: string; evidence: EvidenceRef[] }>> {
  const readmePath = keyFiles.readmeFiles[0];
  if (!readmePath) {
    return [];
  }

  const { text } = await readTextFileLimited(path.join(rootDir, readmePath), 120_000).catch(() => ({
    text: "",
    truncated: false,
  }));
  if (!text) {
    return [];
  }

  const bucket = new Map<string, EvidenceRef[]>();
  const add = (name: string, snippet: string) => {
    if (!/^[A-Z][A-Z0-9_]{2,}$/.test(name)) return;
    if (shouldFilterGenericEnv(name)) return;
    const evidence: EvidenceRef = {
      source: "README mention",
      path: readmePath,
      snippet: snippet.slice(0, 160),
    };
    const list = bucket.get(name) || [];
    if (!list.some((item) => item.snippet === evidence.snippet)) {
      list.push(evidence);
    }
    bucket.set(name, list);
  };

  const envAssignmentPattern = /\b(?:export\s+)?([A-Z][A-Z0-9_]{2,})\s*=/g;
  let match: RegExpExecArray | null;
  while ((match = envAssignmentPattern.exec(text)) !== null) {
    add(match[1], extractLineSnippet(text, match.index));
  }

  const backtickPattern = /`([A-Z][A-Z0-9_]{2,})`/g;
  while ((match = backtickPattern.exec(text)) !== null) {
    const line = extractLineSnippet(text, match.index);
    if (!/(env|variable|api|token|key|secret|config)/i.test(line)) {
      continue;
    }
    add(match[1], line);
  }

  return Array.from(bucket.entries())
    .map(([name, evidence]) => ({ name, evidence: evidence.slice(0, 3) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function extractLineSnippet(text: string, offset: number): string {
  const start = text.lastIndexOf("\n", offset);
  const end = text.indexOf("\n", offset);
  const lineStart = start === -1 ? 0 : start + 1;
  const lineEnd = end === -1 ? text.length : end;
  return text
    .slice(lineStart, lineEnd)
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 160);
}

function looksOptionalByEvidence(evidenceList: EvidenceRef[]): boolean {
  return evidenceList.some((evidence) => {
    const lower = evidence.snippet.toLowerCase();
    return (
      lower.includes("getenv(") && lower.includes(",") ||
      lower.includes(".get(") ||
      lower.includes("default") ||
      lower.includes("??") ||
      lower.includes("||")
    );
  });
}

function dedupeEvidence(items: EvidenceRef[]): EvidenceRef[] {
  const map = new Map<string, EvidenceRef>();
  for (const item of items) {
    const key = `${item.source}|${item.path}|${item.snippet}`;
    if (!map.has(key)) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}
