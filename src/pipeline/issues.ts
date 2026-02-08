import type { ArchitectureMap, EnvAnalysis, IssueItem, KeyFiles, QualitySignal, RiskItem } from "../types.js";

export interface IssueInput {
  risks: RiskItem[];
  architecture: ArchitectureMap;
  keyFiles: KeyFiles;
  envAnalysis?: EnvAnalysis;
  envHints?: string[];
  qualitySignals?: QualitySignal[];
}

export function generateActionableIssues(input: IssueInput): IssueItem[] {
  const issues: IssueItem[] = [];

  for (const risk of input.risks) {
    issues.push({
      id: `issue-${risk.id}`,
      title: risk.title,
      body: `### Summary\n${risk.description}\n\n### Evidence\n${risk.evidence.map((e) => `- ${e}`).join("\n")}\n\n### Suggested action\nReview this finding and update docs/code/config accordingly.`,
      labels: ["reposherlock", `severity:${risk.severity}`, `category:${risk.category}`],
      severity: risk.severity,
      confidence: risk.confidence,
      evidence: risk.evidence,
    });
  }

  const envAnalysis: EnvAnalysis = input.envAnalysis || {
    required: [],
    requiredByFlags: [],
    optional: (input.envHints || []).map((name) => ({ name, confidence: 0.7, evidence: [] })),
    mentioned: [],
    filteredOut: [],
  };
  const repoEnvHints = collectRepoEnvHints(envAnalysis);
  if (!input.keyFiles.envExample && repoEnvHints.length > 0) {
    const uniqueEnvNames = Array.from(new Set(repoEnvHints.map((item) => item.name))).slice(0, 10);
    const readmePath = input.keyFiles.readmeFiles[0];
    const hasReadmeEnvDocs = detectReadmeEnvDocs(envAnalysis);
    const primarySignal = findPrimaryEnvSignal(envAnalysis, repoEnvHints);
    const envEvidenceLines = [
      ".env.example check: not found (.env.example/.env.sample/.env.template).",
      `Repo-specific env vars detected: ${uniqueEnvNames.join(", ")}`,
      readmePath
        ? hasReadmeEnvDocs
          ? `README env/config docs: detected in ${readmePath}, but no .env.example file is provided.`
          : `README env/config docs: not detected in ${readmePath}.`
        : "README env/config docs: README file not found.",
    ];

    if (primarySignal) {
      envEvidenceLines.push(
        `Env detection signal: ${primarySignal.name} (${primarySignal.path}: ${primarySignal.snippet})`,
      );
    }

    const evidenceCount = envEvidenceLines.length;
    const hasRequiredEnv = envAnalysis.required.length > 0 || envAnalysis.requiredByFlags.some((item) => isRepoEnvHint(item));
    const severity = hasRequiredEnv ? "med" : "low";
    issues.push({
      id: "issue-env-example-missing",
      title: "Add .env.example and configuration docs",
      body:
        "### Summary\nEnvironment variables are referenced but no `.env.example` was found.\n\n### Evidence\n" +
        envEvidenceLines.map((line) => `- ${line}`).join("\n") +
        "\n\n### Suggested action\nCreate `.env.example` and document required variables in README quickstart.",
      labels: ["reposherlock", "documentation", `severity:${severity}`],
      severity,
      confidence: confidenceFromEvidence(hasRequiredEnv ? 0.72 : 0.64, evidenceCount),
      evidence: envEvidenceLines,
    });
  }

  const topHotspot = input.architecture.topModules[0];
  if (topHotspot && topHotspot.degree >= 6) {
    const hotspotAction = buildHotspotRefactorHint(topHotspot.path);
    issues.push({
      id: `issue-centrality-${topHotspot.id}`,
      title: `High-centrality module may need refactor: ${topHotspot.path}`,
      body: `### Summary\nModule has high degree centrality (${topHotspot.degree}) in the local dependency graph.\n\n### Evidence\n- Module: ${topHotspot.path}\n- Degree: ${topHotspot.degree}\n\n### Suggested action\n${hotspotAction}`,
      labels: ["reposherlock", "architecture", "severity:low"],
      severity: "low",
      confidence: 0.66,
      evidence: [topHotspot.path],
    });
  }

  for (const signal of input.qualitySignals || []) {
    issues.push({
      id: `issue-${signal.id}`,
      title: signal.title,
      body:
        `### Summary\n${signal.description}\n\n### Evidence\n${signal.evidence.map((line) => `- ${line}`).join("\n")}` +
        "\n\n### Suggested action\nReview this finding and improve project quality/documentation ergonomics.",
      labels: ["reposherlock", "category:quality", `severity:${signal.severity}`],
      severity: signal.severity,
      confidence: signal.confidence,
      evidence: signal.evidence,
    });
  }

  const readmeMissingQuickstart = !input.keyFiles.readmeFiles.length;
  if (readmeMissingQuickstart) {
    issues.push({
      id: "issue-readme-missing",
      title: "README quickstart is missing or incomplete",
      body:
        "### Summary\nNo README file detected during scan.\n\n### Suggested action\nAdd a README with install, run, and troubleshooting sections for first-time contributors.",
      labels: ["reposherlock", "documentation", "severity:med"],
      severity: "med",
      confidence: 0.9,
      evidence: ["README* not found"],
    });
  }

  const bySeverity = (value: string): number => {
    if (value === "high") return 3;
    if (value === "med") return 2;
    return 1;
  };

  const deduped = dedupeIssues(issues);
  deduped.sort((a, b) => bySeverity(b.severity) - bySeverity(a.severity) || b.confidence - a.confidence);
  return deduped;
}

export function selectGoodFirstIssues(issues: IssueItem[]): IssueItem[] {
  const candidates = issues.filter((issue) => {
    const severityOk = issue.severity === "low" || issue.severity === "med";
    const confidenceOk = issue.confidence >= 0.65;
    const labels = issue.labels.map((label) => label.toLowerCase());
    const safeCategory = !labels.some(
      (label) => label.includes("category:secret") || label.includes("category:dependency"),
    );
    const onboardingTag = labels.some(
      (label) => label.includes("documentation") || label.includes("category:quality") || label.includes("architecture"),
    );
    return severityOk && confidenceOk && safeCategory && onboardingTag;
  });

  return candidates
    .slice()
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10);
}

function dedupeIssues(issues: IssueItem[]): IssueItem[] {
  const map = new Map<string, IssueItem>();
  for (const issue of issues) {
    const key = issue.title.toLowerCase();
    if (!map.has(key)) {
      map.set(key, issue);
    }
  }
  return Array.from(map.values());
}

function confidenceFromEvidence(base: number, evidenceCount: number): number {
  const adjusted = Math.min(0.95, base + Math.min(5, Math.max(0, evidenceCount - 1)) * 0.04);
  return Number(adjusted.toFixed(2));
}

function detectReadmeEnvDocs(envAnalysis: EnvAnalysis): boolean {
  if (envAnalysis.mentioned.length > 0) {
    return true;
  }

  const buckets = [envAnalysis.required, envAnalysis.requiredByFlags, envAnalysis.optional];
  for (const bucket of buckets) {
    for (const hint of bucket) {
      if (hint.evidence.some((entry) => isReadmePath(entry.path))) {
        return true;
      }
    }
  }
  return false;
}

function findPrimaryEnvSignal(
  envAnalysis: EnvAnalysis,
  prioritized: Array<{ name: string; confidence: number; evidence: Array<{ path: string; snippet: string }> }> = [],
): { name: string; path: string; snippet: string } | null {
  const ordered = prioritized.length > 0 ? prioritized : collectRepoEnvHints(envAnalysis);
  for (const hint of ordered) {
    const source = hint.evidence[0];
    if (source) {
      return {
        name: hint.name,
        path: source.path,
        snippet: source.snippet.replace(/\s+/g, " ").trim().slice(0, 120),
      };
    }
  }
  return null;
}

function isReadmePath(filePath: string): boolean {
  return /(^|\/)readme(\.[a-z0-9]+)?$/i.test(filePath.replace(/\\/g, "/"));
}

function buildHotspotRefactorHint(modulePath: string): string {
  const normalized = modulePath.replace(/\\/g, "/").toLowerCase();
  if (normalized.endsWith("src/types.ts")) {
    return "Split `src/types.ts` into `src/types/{core,cli,pipeline,risk,output}.ts`, then re-export shared surface from `src/types.ts`.";
  }
  if (normalized.includes("analyzepipeline")) {
    return "Split orchestration logic into stage-specific modules and keep `analyzePipeline` focused on flow coordination.";
  }
  if (normalized.endsWith("src/utils/fs.ts")) {
    return "Split path/string helpers from IO-heavy functions to reduce fan-in and simplify testing.";
  }
  return "Review responsibilities and split into smaller modules if it is becoming a bottleneck.";
}

function collectRepoEnvHints(envAnalysis: EnvAnalysis): Array<{
  name: string;
  confidence: number;
  evidence: Array<{ source: string; path: string; snippet: string }>;
}> {
  const combined = [
    ...envAnalysis.required,
    ...envAnalysis.optional,
    ...envAnalysis.mentioned,
    ...envAnalysis.requiredByFlags.filter((item) => isRepoEnvHint(item)),
  ];
  return combined.filter((item) => isRepoEnvHint(item));
}

function isRepoEnvHint(hint: { evidence: Array<{ source: string; path: string; snippet: string }> }): boolean {
  if (hint.evidence.length === 0) {
    return true;
  }
  return hint.evidence.some((entry) => {
    const source = entry.source.toLowerCase();
    const path = entry.path.toLowerCase();
    const snippet = entry.snippet.toLowerCase();
    if (source.includes("flag requirement")) return false;
    if (path.includes("analysis flags") || path.includes("cli options")) return false;
    if (snippet.includes("--llm") || snippet.includes("llm-mandatory")) return false;
    return true;
  });
}
