import path from "node:path";
import type { FileIndexEntry, FormattingInsight, KeyFiles, QualitySignal, RiskItem } from "../types.js";
import { readTextFileLimited } from "../utils/fs.js";

export interface CiQualityResult {
  risks: RiskItem[];
  qualitySignals: QualitySignal[];
  formatting: FormattingInsight;
}

interface PackageJsonQualityLite {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

type QualityProfile = "javascript" | "python" | "mixed" | "unknown";

const FORMAT_CONFIG_FILES = [
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.js",
  ".prettierrc.cjs",
  ".prettierrc.yaml",
  ".prettierrc.yml",
  "prettier.config.js",
  "prettier.config.cjs",
  "prettier.config.mjs",
  "biome.json",
  "biome.jsonc",
];

const LINT_CONFIG_FILES = [
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".eslintrc.yaml",
  ".eslintrc.yml",
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
];

const PYTHON_FORMAT_CONFIG_FILES = [
  ".ruff.toml",
  "ruff.toml",
  "pyproject.toml",
  "setup.cfg",
  "tox.ini",
  ".flake8",
  ".pre-commit-config.yaml",
];

const PYTHON_TOOL_DEFINITIONS: Array<{ tool: string; patterns: RegExp[]; kind: "format" | "lint" }> = [
  { tool: "ruff", kind: "format", patterns: [/\[tool\.ruff(\.format)?\]/i, /\bruff\b/i] },
  { tool: "black", kind: "format", patterns: [/\[tool\.black\]/i, /\bblack\b/i] },
  { tool: "isort", kind: "format", patterns: [/\[tool\.isort\]/i, /\bisort\b/i] },
  { tool: "autopep8", kind: "format", patterns: [/\[tool\.autopep8\]/i, /\bautopep8\b/i] },
  { tool: "yapf", kind: "format", patterns: [/\[tool\.yapf\]/i, /\byapf\b/i] },
  { tool: "flake8", kind: "lint", patterns: [/\[tool\.flake8\]/i, /\bflake8\b/i] },
  { tool: "mypy", kind: "lint", patterns: [/\[tool\.mypy\]/i, /\bmypy\b/i] },
  { tool: "pylint", kind: "lint", patterns: [/\bpylint\b/i] },
];

export async function detectCiAndQuality(
  rootDir: string,
  keyFiles: KeyFiles,
  fileIndex: FileIndexEntry[],
): Promise<CiQualityResult> {
  const risks: RiskItem[] = [];
  const qualitySignals: QualitySignal[] = [];

  if (keyFiles.ciWorkflows.length === 0) {
    risks.push({
      id: "ci-missing",
      category: "ci",
      severity: "med",
      confidence: 0.9,
      title: "No CI workflow detected",
      description: "No .github/workflows pipeline found; automated checks may be missing.",
      evidence: [".github/workflows/* not found"],
    });
  }

  const qualityProfile = detectQualityProfile(keyFiles, fileIndex);
  const formatting = await detectFormattingInsight(rootDir, keyFiles, fileIndex, qualityProfile);

  if (keyFiles.packageJson) {
    const pkgPath = path.join(rootDir, keyFiles.packageJson);
    const { text } = await readTextFileLimited(pkgPath, 500_000).catch(() => ({ text: "", truncated: false }));
    if (text) {
      const pkg = safeParsePackageJson(text);
      if (!pkg) {
        qualitySignals.push({
          id: "quality-package-json-invalid",
          severity: "med",
          confidence: 0.82,
          title: "package.json could not be parsed",
          description: "package.json contains invalid JSON, reducing script/tool detection reliability.",
          evidence: [keyFiles.packageJson],
        });
      } else {
        const scripts = pkg.scripts || {};
        if (!scripts.test) {
          qualitySignals.push({
            id: "quality-no-test-script",
            severity: "med",
            confidence: 0.88,
            title: "No test script in package.json",
            description: "package.json does not define a test script.",
            evidence: [keyFiles.packageJson],
          });
        }
      }
    }
  }

  if (qualityProfile === "javascript" || qualityProfile === "mixed") {
    if (!formatting.hasFormatScript && formatting.detectedTools.length > 0) {
      qualitySignals.push({
        id: "quality-format-tool-no-script",
        severity: "low",
        confidence: 0.84,
        title: "Formatting tool detected but no format script",
        description: `Formatting tooling is present (${formatting.detectedTools.join(", ")}) but package scripts do not expose a format command.`,
        evidence: formatting.evidence.slice(0, 6).map((item) => `${item.path}: ${item.snippet}`),
      });
    } else if (!formatting.hasFormatScript && formatting.detectedTools.length === 0) {
      qualitySignals.push({
        id: "quality-no-format-tooling",
        severity: "low",
        confidence: 0.78,
        title: "No formatting tool or script detected",
        description: "No format/fmt/prettier/biome script or known formatter configuration was detected.",
        evidence: [keyFiles.packageJson || "package.json not found"],
      });
    }
  } else if (qualityProfile === "python") {
    const hasPythonFormatter = formatting.detectedTools.some((tool) =>
      ["ruff", "black", "isort", "autopep8", "yapf"].includes(tool.toLowerCase())
    );
    const hasPythonLint = formatting.detectedTools.some((tool) =>
      ["ruff", "flake8", "mypy", "pylint"].includes(tool.toLowerCase())
    );

    if (!hasPythonFormatter && !hasPythonLint && !formatting.hasFormatScript) {
      qualitySignals.push({
        id: "quality-no-python-tooling",
        severity: "low",
        confidence: 0.78,
        title: "No Python formatting/lint tooling detected",
        description: "No ruff/black/isort/yapf/autopep8/flake8/mypy tooling or format target was detected.",
        evidence: [
          keyFiles.pyprojectToml || "pyproject.toml not found",
          keyFiles.requirementsTxt || "requirements.txt not found",
        ],
      });
    } else if (!hasPythonFormatter) {
      qualitySignals.push({
        id: "quality-python-no-formatter",
        severity: "low",
        confidence: 0.72,
        title: "Python lint tooling detected but formatter missing",
        description: "Lint tools are present, but no formatter signal (ruff/black/isort/yapf/autopep8) was detected.",
        evidence: formatting.evidence.slice(0, 6).map((item) => `${item.path}: ${item.snippet}`),
      });
    }
  }

  return {
    risks,
    qualitySignals,
    formatting,
  };
}

async function detectFormattingInsight(
  rootDir: string,
  keyFiles: KeyFiles,
  fileIndex: FileIndexEntry[],
  profile: QualityProfile,
): Promise<FormattingInsight> {
  const detectedTools = new Set<string>();
  const dependencyTools = new Set<string>();
  const configFiles = new Set<string>();
  const evidence: FormattingInsight["evidence"] = [];
  const formatScriptNames: string[] = [];
  const lintScriptNames: string[] = [];

  if (keyFiles.packageJson) {
    const pkgPath = path.join(rootDir, keyFiles.packageJson);
    const { text } = await readTextFileLimited(pkgPath, 500_000).catch(() => ({ text: "", truncated: false }));
    if (text) {
      const pkg = safeParsePackageJson(text);
      if (!pkg) {
        return {
          ecosystem: profile,
          detectedTools: [],
          dependencyTools: [],
          configFiles: [],
          hasFormatScript: false,
          hasLintScript: false,
          formatScriptNames: [],
          lintScriptNames: [],
          evidence: [
            {
              source: "package.json",
              path: keyFiles.packageJson,
              snippet: "Could not parse package.json",
            },
          ],
        };
      }

      const scripts = pkg.scripts || {};
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

      for (const [scriptName, scriptBody] of Object.entries(scripts)) {
        const lower = scriptName.toLowerCase();
        if (isFormatScriptName(lower)) {
          formatScriptNames.push(scriptName);
          evidence.push({
            source: "package.json scripts",
            path: keyFiles.packageJson,
            snippet: `scripts.${scriptName}: ${scriptBody.slice(0, 140)}`,
          });
        }
        if (isLintScriptName(lower)) {
          lintScriptNames.push(scriptName);
          evidence.push({
            source: "package.json scripts",
            path: keyFiles.packageJson,
            snippet: `scripts.${scriptName}: ${scriptBody.slice(0, 140)}`,
          });
        }
      }

      if (deps["@biomejs/biome"] || deps.biome || packageHasToolReference(scripts, "biome")) {
        detectedTools.add("biome");
        if (deps["@biomejs/biome"] || deps.biome) dependencyTools.add("biome");
      }
      if (deps.prettier || packageHasToolReference(scripts, "prettier")) {
        detectedTools.add("prettier");
        if (deps.prettier) dependencyTools.add("prettier");
      }
      if (deps.eslint || packageHasToolReference(scripts, "eslint")) {
        detectedTools.add("eslint");
        if (deps.eslint) dependencyTools.add("eslint");
      }

      for (const tool of detectedTools) {
        evidence.push({
          source: "package.json dependencies",
          path: keyFiles.packageJson,
          snippet: `Detected tooling dependency: ${tool}`,
        });
      }
    }
  }

  if (profile === "python" || profile === "mixed") {
    if (keyFiles.pyprojectToml) {
      const pyprojectPath = path.join(rootDir, keyFiles.pyprojectToml);
      const { text } = await readTextFileLimited(pyprojectPath, 350_000).catch(() => ({ text: "", truncated: false }));
      if (text) {
        for (const definition of PYTHON_TOOL_DEFINITIONS) {
          if (definition.patterns.some((pattern) => pattern.test(text))) {
            detectedTools.add(definition.tool);
            if (definition.kind === "format") {
              dependencyTools.add(definition.tool);
            }
            evidence.push({
              source: "pyproject.toml",
              path: keyFiles.pyprojectToml,
              snippet: `Detected Python tooling section or reference: ${definition.tool}`,
            });
          }
        }
      }
    }

    if (keyFiles.requirementsTxt) {
      const requirementsPath = path.join(rootDir, keyFiles.requirementsTxt);
      const { text } = await readTextFileLimited(requirementsPath, 250_000).catch(() => ({ text: "", truncated: false }));
      if (text) {
        const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
        for (const line of lines) {
          const lower = line.toLowerCase();
          for (const definition of PYTHON_TOOL_DEFINITIONS) {
            if (lower.startsWith(definition.tool) || lower.includes(`${definition.tool}==`)) {
              detectedTools.add(definition.tool);
              if (definition.kind === "format") {
                dependencyTools.add(definition.tool);
              }
              evidence.push({
                source: "requirements.txt",
                path: keyFiles.requirementsTxt,
                snippet: `Detected Python tooling dependency: ${definition.tool}`,
              });
            }
          }
        }
      }
    }

    if (keyFiles.makefile) {
      const makePath = path.join(rootDir, keyFiles.makefile);
      const { text } = await readTextFileLimited(makePath, 200_000).catch(() => ({ text: "", truncated: false }));
      if (text) {
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (/^(format|fmt)\s*:/.test(trimmed)) {
            formatScriptNames.push("make format");
            evidence.push({
              source: "makefile target",
              path: keyFiles.makefile,
              snippet: trimmed.slice(0, 160),
            });
          } else if (/^(lint|check)\s*:/.test(trimmed)) {
            lintScriptNames.push(`make ${trimmed.split(":")[0]}`);
            evidence.push({
              source: "makefile target",
              path: keyFiles.makefile,
              snippet: trimmed.slice(0, 160),
            });
          }
        }
      }
    }
  }

  for (const relPath of findConfigMatches(fileIndex, FORMAT_CONFIG_FILES)) {
    configFiles.add(relPath);
    if (relPath.toLowerCase().includes("biome")) {
      detectedTools.add("biome");
    } else {
      detectedTools.add("prettier");
    }
    evidence.push({
      source: "formatter config",
      path: relPath,
      snippet: "Formatter config file detected.",
    });
  }

  for (const relPath of findConfigMatches(fileIndex, LINT_CONFIG_FILES)) {
    configFiles.add(relPath);
    detectedTools.add("eslint");
    evidence.push({
      source: "linter config",
      path: relPath,
      snippet: "Linter config file detected.",
    });
  }

  if (profile === "python" || profile === "mixed") {
    for (const relPath of findConfigMatches(fileIndex, PYTHON_FORMAT_CONFIG_FILES)) {
      configFiles.add(relPath);
      const lower = relPath.toLowerCase();
      if (lower.includes("ruff")) detectedTools.add("ruff");
      if (lower.includes("black")) detectedTools.add("black");
      if (lower.includes("isort")) detectedTools.add("isort");
      if (lower.includes("mypy")) detectedTools.add("mypy");
      if (lower.includes("flake8")) detectedTools.add("flake8");
      if (lower.includes("pre-commit")) detectedTools.add("pre-commit");
      evidence.push({
        source: "python tooling config",
        path: relPath,
        snippet: "Python formatting/lint config file detected.",
      });
    }
  }

  return {
    ecosystem: profile,
    detectedTools: Array.from(detectedTools).sort(),
    dependencyTools: Array.from(dependencyTools).sort(),
    configFiles: Array.from(configFiles).sort(),
    hasFormatScript: formatScriptNames.length > 0,
    hasLintScript: lintScriptNames.length > 0,
    formatScriptNames: Array.from(new Set(formatScriptNames)).sort(),
    lintScriptNames: Array.from(new Set(lintScriptNames)).sort(),
    evidence: dedupeEvidence(evidence),
  };
}

function detectQualityProfile(keyFiles: KeyFiles, fileIndex: FileIndexEntry[]): QualityProfile {
  const hasJsSignals = Boolean(keyFiles.packageJson);
  const hasPythonSignals = Boolean(
    keyFiles.pyprojectToml ||
      keyFiles.requirementsTxt ||
      fileIndex.some((entry) => entry.ext === ".py"),
  );

  if (hasJsSignals && hasPythonSignals) return "mixed";
  if (hasJsSignals) return "javascript";
  if (hasPythonSignals) return "python";
  return "unknown";
}

function packageHasToolReference(scripts: Record<string, string>, token: string): boolean {
  const needle = token.toLowerCase();
  return Object.values(scripts).some((script) => script.toLowerCase().includes(needle));
}

function isFormatScriptName(name: string): boolean {
  return (
    name === "format" ||
    name === "fmt" ||
    name === "prettier" ||
    name === "biome" ||
    name.startsWith("format:") ||
    name.includes("fmt")
  );
}

function isLintScriptName(name: string): boolean {
  return name === "lint" || name.startsWith("lint:") || name.includes("eslint");
}

function findConfigMatches(index: FileIndexEntry[], names: string[]): string[] {
  const normalized = new Set(names.map((name) => name.toLowerCase()));
  const matches: string[] = [];
  for (const entry of index) {
    const lower = entry.relPath.toLowerCase();
    const base = lower.split("/").pop() || lower;
    if (normalized.has(base)) {
      matches.push(entry.relPath);
    }
  }
  return matches;
}

function dedupeEvidence(items: FormattingInsight["evidence"]): FormattingInsight["evidence"] {
  const map = new Map<string, FormattingInsight["evidence"][number]>();
  for (const item of items) {
    const key = `${item.source}|${item.path}|${item.snippet}`;
    if (!map.has(key)) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}

function safeParsePackageJson(text: string): PackageJsonQualityLite | null {
  try {
    return JSON.parse(text) as PackageJsonQualityLite;
  } catch {
    return null;
  }
}
