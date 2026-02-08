import path from "node:path";
import type {
  ConfigSnapshot,
  DeterministicSummary,
  EnvAnalysis,
  FileIndexEntry,
  FormattingInsight,
  IssueItem,
  LlmEnhancementOutput,
  RepoIdentity,
  RiskItem,
  RunAttemptResult,
} from "../types.js";
import { ensureDir, writeJsonFile, writeTextFile } from "../utils/fs.js";
import {
  renderArchitectureMermaid,
  renderGoodFirstIssuesMarkdown,
  renderIssuesAsMarkdown,
  renderPrDraftMarkdown,
  renderReadme20Markdown,
  renderReportMarkdown,
  renderRisksMarkdown,
  renderRunAttemptMarkdown,
} from "./renderers.js";
import { buildIssuesSarif } from "./sarif.js";
import { selectGoodFirstIssues } from "../pipeline/issues.js";

export interface WriteArtifactsInput {
  outputDir: string;
  summary: DeterministicSummary;
  fileIndex: FileIndexEntry[];
  risks: RiskItem[];
  issues: IssueItem[];
  likelyPurpose: string;
  deterministicLikelyPurpose?: string;
  envHints: string[];
  envAnalysis: EnvAnalysis;
  formatting: FormattingInsight;
  detectedLicense: string | null;
  config: ConfigSnapshot;
  llmUsed: boolean;
  llmResult?: LlmEnhancementOutput;
  runAttempt?: RunAttemptResult;
  generatePrDraft?: boolean;
}

export async function writeAllArtifacts(input: WriteArtifactsInput): Promise<void> {
  await ensureDir(input.outputDir);
  await ensureDir(path.join(input.outputDir, "issue_templates"));
  const deterministicLikelyPurpose = input.deterministicLikelyPurpose || input.likelyPurpose;

  const deterministicReportCore = renderReportMarkdown({
    summary: input.summary,
    likelyPurpose: deterministicLikelyPurpose,
    envHints: input.envHints,
    envAnalysis: input.envAnalysis,
    detectedLicense: input.detectedLicense,
    formatting: input.formatting,
    config: input.config,
    llmUsed: false,
    prDraftEnabled: Boolean(input.generatePrDraft),
  });

  const deterministicReportRun = renderReportMarkdown({
    summary: input.summary,
    likelyPurpose: input.likelyPurpose,
    envHints: input.envHints,
    envAnalysis: input.envAnalysis,
    detectedLicense: input.detectedLicense,
    formatting: input.formatting,
    config: input.config,
    llmUsed: input.llmUsed,
    prDraftEnabled: Boolean(input.generatePrDraft),
  });

  const deterministicReadme = renderReadme20Markdown({
    summary: input.summary,
    likelyPurpose: deterministicLikelyPurpose,
    envHints: input.envHints,
    envAnalysis: input.envAnalysis,
    config: input.config,
    llmUsed: false,
  });

  const deterministicIssues = input.issues;

  const reportBase = selectReportBase({
    llmUsed: input.llmUsed,
    llmReport: input.llmResult?.report,
    deterministicReport: deterministicReportRun,
    hasTryRun: Boolean(input.runAttempt),
  });
  const readmeBase = input.llmUsed && input.llmResult?.readme ? input.llmResult.readme : deterministicReadme;
  const issuesFinal = input.llmUsed && input.llmResult?.issuesJson ? input.llmResult.issuesJson : deterministicIssues;
  const reportFinalBase = input.llmUsed ? ensureLlmDisclaimer(reportBase) : reportBase;
  const reportFinal = enforceLikelyPurposeLine(enforceLlmNote(reportFinalBase, input.llmUsed), input.likelyPurpose);
  const readmeFinal = input.llmUsed ? ensureLlmDisclaimer(readmeBase) : readmeBase;
  const goodFirstIssues = selectGoodFirstIssues(issuesFinal);

  const architectureMmd = renderArchitectureMermaid(
    input.summary.architecture,
    input.summary.repoIdentity,
    input.summary.generatedAt,
    input.config,
  );

  const risksMd = renderRisksMarkdown({
    repoIdentity: input.summary.repoIdentity,
    generatedAt: input.summary.generatedAt,
    config: input.config,
    risks: input.risks,
  });

  await writeTextFile(
    path.join(input.outputDir, "report.md"),
    ensureMetadataPrefix(reportFinal, input.summary.repoIdentity, input.summary.generatedAt, input.config),
  );
  await writeJsonFile(path.join(input.outputDir, "report.json"), withMeta(input.summary.repoIdentity, input.config, {
    generatedAt: input.summary.generatedAt,
    summary: input.summary,
    likelyPurpose: input.likelyPurpose,
    envHints: input.envHints,
    envAnalysis: input.envAnalysis,
    formatting: input.formatting,
    detectedLicense: input.detectedLicense,
  }));

  await writeTextFile(path.join(input.outputDir, "architecture.mmd"), architectureMmd);
  await writeJsonFile(path.join(input.outputDir, "architecture.json"), withMeta(input.summary.repoIdentity, input.config, {
    generatedAt: input.summary.generatedAt,
    architecture: input.summary.architecture,
  }));

  await writeTextFile(path.join(input.outputDir, "risks.md"), risksMd);
  await writeJsonFile(path.join(input.outputDir, "risks.json"), withMeta(input.summary.repoIdentity, input.config, {
    generatedAt: input.summary.generatedAt,
    risks: input.risks,
  }));

  await writeJsonFile(path.join(input.outputDir, "issues.json"), withMeta(input.summary.repoIdentity, input.config, {
    generatedAt: input.summary.generatedAt,
    issues: issuesFinal,
  }));
  await writeJsonFile(
    path.join(input.outputDir, "issues.good-first.json"),
    withMeta(input.summary.repoIdentity, input.config, {
      generatedAt: input.summary.generatedAt,
      issues: goodFirstIssues,
    }),
  );
  await writeTextFile(
    path.join(input.outputDir, "issues.good-first.md"),
    renderGoodFirstIssuesMarkdown({
      repoIdentity: input.summary.repoIdentity,
      generatedAt: input.summary.generatedAt,
      config: input.config,
      issues: goodFirstIssues,
    }),
  );
  await writeJsonFile(
    path.join(input.outputDir, "issues.sarif"),
    buildIssuesSarif({
      issues: issuesFinal,
      repoIdentity: input.summary.repoIdentity,
      generatedAt: input.summary.generatedAt,
      config: input.config,
    }),
  );

  await writeTextFile(
    path.join(input.outputDir, "README_2.0.md"),
    ensureMetadataPrefix(readmeFinal, input.summary.repoIdentity, input.summary.generatedAt, input.config),
  );
  await writeJsonFile(path.join(input.outputDir, "file_index.json"), withMeta(input.summary.repoIdentity, input.config, {
    generatedAt: input.summary.generatedAt,
    files: input.fileIndex,
  }));

  if (input.runAttempt) {
    const runMd = renderRunAttemptMarkdown({
      repoIdentity: input.summary.repoIdentity,
      generatedAt: input.summary.generatedAt,
      config: input.config,
      result: input.runAttempt,
    });
    await writeTextFile(path.join(input.outputDir, "run_attempt.md"), runMd);
    await writeJsonFile(path.join(input.outputDir, "run_attempt.json"), withMeta(input.summary.repoIdentity, input.config, {
      generatedAt: input.summary.generatedAt,
      runAttempt: input.runAttempt,
    }));
  }

  if (input.generatePrDraft) {
    await writeTextFile(
      path.join(input.outputDir, "pr_draft.md"),
      renderPrDraftMarkdown({
        repoIdentity: input.summary.repoIdentity,
        generatedAt: input.summary.generatedAt,
        config: input.config,
        issues: issuesFinal,
        goodFirst: goodFirstIssues,
      }),
    );
  }

  for (const issue of issuesFinal) {
    const safeFile = sanitizeFileName(issue.id || issue.title);
    await writeTextFile(path.join(input.outputDir, "issue_templates", `${safeFile}.md`), renderIssuesAsMarkdown(issue));
  }

  await writeHtmlViewer(input.outputDir, reportFinal, input.summary.repoIdentity, input.summary.generatedAt, input.config);

  if (input.llmUsed) {
    await writeTextFile(
      path.join(input.outputDir, "README_2.0.deterministic.md"),
      ensureMetadataPrefix(deterministicReadme, input.summary.repoIdentity, input.summary.generatedAt, input.config),
    );
    await writeTextFile(
      path.join(input.outputDir, "README_2.0.llm.md"),
      ensureMetadataPrefix(
        ensureLlmDisclaimer(input.llmResult?.readme || deterministicReadme),
        input.summary.repoIdentity,
        input.summary.generatedAt,
        input.config,
      ),
    );
    await writeJsonFile(
      path.join(input.outputDir, "issues.deterministic.json"),
      withMeta(input.summary.repoIdentity, input.config, { generatedAt: input.summary.generatedAt, issues: deterministicIssues }),
    );
    await writeJsonFile(
      path.join(input.outputDir, "issues.llm.json"),
      withMeta(input.summary.repoIdentity, input.config, { generatedAt: input.summary.generatedAt, issues: issuesFinal }),
    );
    await writeTextFile(
      path.join(input.outputDir, "report.deterministic.md"),
      ensureMetadataPrefix(deterministicReportCore, input.summary.repoIdentity, input.summary.generatedAt, input.config),
    );
    await writeTextFile(
      path.join(input.outputDir, "report.llm.md"),
      ensureMetadataPrefix(
        enforceLikelyPurposeLine(enforceLlmNote(ensureLlmDisclaimer(reportFinal), true), input.likelyPurpose),
        input.summary.repoIdentity,
        input.summary.generatedAt,
        input.config,
      ),
    );
  }
}

function withMeta(repoIdentity: RepoIdentity, config: ConfigSnapshot, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    metadata: {
      generatedAt: payload.generatedAt,
      repo: repoIdentity,
      config,
    },
    ...payload,
  };
}

function sanitizeFileName(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 80);
}

async function writeHtmlViewer(
  outputDir: string,
  reportMd: string,
  repo: RepoIdentity,
  generatedAt: string,
  config: ConfigSnapshot,
): Promise<void> {
  const escaped = reportMd
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>RepoSherlock Report</title>
<style>
:root { color-scheme: light; }
body { margin:0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background:#f4f6f8; color:#17212b; }
header { padding:16px 20px; background:#0f253f; color:#eaf2ff; }
main { max-width: 1100px; margin: 20px auto; padding: 0 16px 24px; }
.card { background:white; border-radius:12px; box-shadow:0 6px 24px rgba(0,0,0,0.07); padding:18px; overflow:auto; }
pre { white-space: pre-wrap; word-break: break-word; }
.small { opacity:.8; font-size: 12px; }
</style>
</head>
<body>
<header>
<h1>RepoSherlock</h1>
<div class="small">${repo.displayName} | ${generatedAt}</div>
</header>
<main>
<div class="card">
<pre>${escaped}</pre>
</div>
<div class="small">tool=${config.toolVersion}</div>
</main>
</body>
</html>`;

  await writeTextFile(path.join(outputDir, "report.html"), html);
}

function ensureMetadataPrefix(content: string, repo: RepoIdentity, generatedAt: string, config: ConfigSnapshot): string {
  if (content.includes("generated_at:") && content.includes("repo_input:")) {
    return content;
  }

  const configSnapshot = JSON.stringify(config.analyzeOptions).replace(/'/g, "''");
  const header = [
    "```yaml",
    `generated_at: ${generatedAt}`,
    `repo_input: ${repo.input}`,
    `repo_name: ${repo.displayName}`,
    `repo_source: ${repo.sourceType}`,
    `tool_version: ${config.toolVersion}`,
    `config_snapshot: '${configSnapshot}'`,
    "```",
    "",
  ].join("\n");

  if (content.startsWith("```yaml")) {
    return content;
  }
  return `${header}${content}`;
}

function ensureLlmDisclaimer(content: string): string {
  const disclaimer = "LLM-assisted text generation enabled; verify instructions.";
  if (content.toLowerCase().includes("llm-assisted text generation enabled")) {
    return content;
  }
  return `${disclaimer}\n\n${content}`;
}

function enforceLlmNote(content: string, llmUsed: boolean): string {
  if (!llmUsed) {
    return content;
  }

  const noteSection = "## LLM Note\n\n- LLM-assisted text generation enabled; verify instructions.\n";
  const pattern = /## LLM Note[\s\S]*?(?=\n## |\s*$)/i;

  if (pattern.test(content)) {
    return content.replace(pattern, noteSection.trimEnd());
  }

  return `${content.trimEnd()}\n\n${noteSection}`;
}

function enforceLikelyPurposeLine(content: string, likelyPurpose: string): string {
  const purposeLine = `- **Purpose guess:** ${likelyPurpose}`;
  const linePattern = /^- \*\*Purpose guess:\*\*.*$/m;
  if (linePattern.test(content)) {
    return content.replace(linePattern, purposeLine);
  }

  const sectionHeading = "## What This Repo Likely Is";
  const headingPattern = new RegExp(`^${escapeRegex(sectionHeading)}\\s*$`, "m");
  const match = content.match(headingPattern);
  if (!match || match.index === undefined) {
    return content;
  }

  const insertAt = match.index + match[0].length;
  return `${content.slice(0, insertAt)}\n\n${purposeLine}${content.slice(insertAt)}`;
}

function selectReportBase(input: {
  llmUsed: boolean;
  llmReport?: string;
  deterministicReport: string;
  hasTryRun: boolean;
}): string {
  if (!input.llmUsed || !input.llmReport) {
    return input.deterministicReport;
  }

  if (!looksLikeValidReport(input.llmReport, input.hasTryRun)) {
    return input.deterministicReport;
  }

  const lockedReport = enforceDeterministicCommandSections(
    input.llmReport,
    input.deterministicReport,
    input.hasTryRun,
  );

  if (!looksLikeValidReport(lockedReport, input.hasTryRun)) {
    return input.deterministicReport;
  }

  return lockedReport;
}

function looksLikeValidReport(content: string, hasTryRun: boolean): boolean {
  const requiredSections = [
    "## Scan Confidence & Coverage",
    "## What This Repo Likely Is",
    "## How To Run (Best Guess)",
    "## Risks",
    "## Where To Improve",
    "## Try-Run Results",
    "## Next 3 Actions",
  ];
  if (hasTryRun) {
    requiredSections.push("## Try-Run Summary");
  }
  const normalized = content.toLowerCase();
  for (const heading of requiredSections) {
    if (!normalized.includes(heading.toLowerCase())) {
      return false;
    }
  }

  if (hasTryRun && !normalized.includes("| step |")) {
    return false;
  }

  return true;
}

function enforceDeterministicCommandSections(
  llmReport: string,
  deterministicReport: string,
  hasTryRun: boolean,
): string {
  const headings = ["## How To Run (Best Guess)", "## Try-Run Results"];
  if (hasTryRun) {
    headings.push("## Try-Run Summary");
  }

  let merged = llmReport;
  for (const heading of headings) {
    const deterministicSection = extractSectionByHeading(deterministicReport, heading);
    if (!deterministicSection) {
      continue;
    }
    merged = replaceSectionByHeading(merged, heading, deterministicSection);
  }
  return merged;
}

function extractSectionByHeading(markdown: string, heading: string): string | null {
  const escaped = escapeRegex(heading);
  const regex = new RegExp(`^${escaped}[\\s\\S]*?(?=^##\\s|\\Z)`, "m");
  const match = markdown.match(regex);
  return match ? match[0].trimEnd() : null;
}

function replaceSectionByHeading(markdown: string, heading: string, replacement: string): string {
  const escaped = escapeRegex(heading);
  const regex = new RegExp(`^${escaped}[\\s\\S]*?(?=^##\\s|\\Z)`, "m");
  if (!regex.test(markdown)) {
    return markdown;
  }
  return markdown.replace(regex, replacement);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
