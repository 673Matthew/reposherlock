import type {
  AnalyzeOptions,
  ArchitectureMap,
  CommandExecution,
  ConfigSnapshot,
  DeterministicSummary,
  EnvAnalysis,
  EvidenceRef,
  FormattingInsight,
  IssueItem,
  RepoIdentity,
  RiskItem,
  RunAttemptResult,
  Severity,
} from "../types.js";

export function renderArchitectureMermaid(
  architecture: ArchitectureMap,
  repoIdentity: RepoIdentity,
  generatedAt: string,
  config: ConfigSnapshot,
): string {
  const lines: string[] = [];
  lines.push(`%% RepoSherlock architecture map`);
  lines.push(`%% generated_at: ${generatedAt}`);
  lines.push(`%% repo: ${repoIdentity.displayName}`);
  lines.push(`%% config_snapshot: ${JSON.stringify(config.analyzeOptions)}`);
  lines.push(`%% parse_coverage: ${Math.round(architecture.metrics.parseCoverage * 100)}%`);
  lines.push("graph TD");

  if (architecture.edges.length === 0) {
    lines.push("  A[\"No module edges detected\"]");
    return lines.join("\n");
  }

  const idMap = new Map<string, string>();
  let idx = 0;
  for (const node of architecture.nodes) {
    idMap.set(node.id, `N${idx}`);
    idx += 1;
  }

  for (const node of architecture.nodes.slice(0, 220)) {
    const id = idMap.get(node.id)!;
    const label = escapeMermaidLabel(`${node.path} (${node.degree})`);
    lines.push(`  ${id}["${label}"]`);
  }

  for (const edge of architecture.edges.slice(0, 600)) {
    const from = idMap.get(edge.from);
    const to = idMap.get(edge.to);
    if (!from || !to) continue;
    lines.push(`  ${from} --> ${to}`);
  }

  return lines.join("\n");
}

export function renderReportMarkdown(input: {
  summary: DeterministicSummary;
  likelyPurpose: string;
  envHints: string[];
  envAnalysis: EnvAnalysis;
  detectedLicense: string | null;
  formatting: FormattingInsight;
  config: ConfigSnapshot;
  llmUsed: boolean;
  llmNote?: string;
  prDraftEnabled?: boolean;
}): string {
  const { summary } = input;
  const topIssues = summary.issues.slice(0, 5);
  const riskIssues = summary.issues.filter(isRiskIssue).slice(0, 5);
  const improveIssues = summary.issues.filter(isImproveIssue).slice(0, 5);
  const improveCounts = countBySeverity(improveIssues.map((issue) => issue.severity));
  const nextActions = pickNextActions(summary.issues, 3);

  const risksBySeverity = countBySeverity(summary.risks.map((risk) => risk.severity));
  const classificationEvidence = summary.evidence?.classification || [];
  const purposeEvidence = summary.evidence?.purpose || [];
  const runEvidence = summary.evidence?.run || [];
  const envEvidence = summary.evidence?.env || [];
  const architectureEvidence = summary.evidence?.architecture || [];

  const purposeConfidence = confidenceFromEvidence(summary.classification.confidence, purposeEvidence.length);
  const runConfidence = confidenceFromEvidence(0.66, runEvidence.length);
  const envConfidence = confidenceFromEvidence(0.64, envEvidence.length);
  const architectureConfidence = confidenceFromEvidence(0.72, architectureEvidence.length);
  const runRecommendation = recommendRunCommand(summary, runEvidence);

  const lines: string[] = [];
  lines.push("# RepoSherlock Report");
  lines.push("");
  lines.push(renderMetadataBlock(summary.repoIdentity, summary.generatedAt, input.config));
  lines.push("");
  lines.push("> Heuristic analysis. Verify commands and assumptions before production use.");
  lines.push("");

  if (input.llmUsed) {
    lines.push("> LLM-assisted text generation enabled; verify instructions.");
    if (input.llmNote) {
      lines.push(`> ${input.llmNote}`);
    }
    lines.push("");
  }

  lines.push("## Scan Confidence & Coverage");
  lines.push("");
  const tsJsFiles = summary.metrics?.tsJsFiles ?? summary.architecture.metrics.tsJsSourceFiles;
  const tsJsParsed = summary.metrics?.tsJsParsed ?? summary.architecture.metrics.tsJsParsedFiles;
  const parseSuccessPct = tsJsFiles > 0
    ? Math.round((tsJsParsed / tsJsFiles) * 100)
    : Math.round(summary.architecture.metrics.tsJsCoverage * 100);
  const tsJsFilesWithEdges = summary.architecture.metrics.tsJsFilesWithEdges
    ?? estimateTsJsFilesWithEdges(summary.architecture);
  const graphYieldPct = tsJsFiles > 0
    ? Math.round((tsJsFilesWithEdges / tsJsFiles) * 100)
    : 0;
  lines.push(`- Files scanned: ${summary.metrics?.filesScanned ?? "unknown"}`);
  lines.push(`- Text files read: ${summary.metrics?.textFilesScanned ?? "unknown"}`);
  lines.push(`- JS/TS files: ${tsJsFiles}`);
  lines.push(`- Parse success: ${tsJsParsed}/${tsJsFiles} (${parseSuccessPct}%)`);
  lines.push(`- Graph yield: ${tsJsFilesWithEdges}/${tsJsFiles} (${graphYieldPct}%)`);
  lines.push(`- Parsed modules: ${summary.metrics?.parsedModules ?? summary.architecture.metrics.parsedFiles}`);
  lines.push(`- Skipped (size/binary): ${summary.metrics?.skippedBinaryOrLarge ?? "unknown"}`);
  lines.push(`- Warnings count: ${summary.metrics?.warningsCount ?? summary.risks.length + improveIssues.length}`);
  lines.push("");

  if (summary.tryRun) {
    appendTryRunSummary(lines, summary.tryRun.executions);
    lines.push("");
  }

  lines.push("## What This Repo Likely Is");
  lines.push("");
  lines.push(`- **Project type:** ${summary.classification.projectType}`);
  lines.push(`- **Runtime:** ${summary.classification.runtime}`);
  lines.push(`- **Framework guess:** ${summary.classification.frameworkGuess || "unknown"}`);
  lines.push(`- **Purpose guess:** ${input.likelyPurpose}`);
  const entrypointSplit = splitEntrypoints(summary.keyFiles.entrypoints);
  lines.push(
    `- **Runtime entrypoints:** ${entrypointSplit.runtime.length ? entrypointSplit.runtime.slice(0, 5).map((entry) => `\`${entry}\``).join(", ") : "none"}`,
  );
  lines.push(
    `- **Library entrypoints:** ${entrypointSplit.library.length ? entrypointSplit.library.slice(0, 5).map((entry) => `\`${entry}\``).join(", ") : "none"}`,
  );
  lines.push(
    `- **Confidence:** ${purposeConfidence.toFixed(2)} (${purposeEvidence.length} evidence point${purposeEvidence.length === 1 ? "" : "s"})`,
  );
  lines.push("");
  appendEvidenceBlock(lines, [...classificationEvidence, ...purposeEvidence], 4);
  lines.push("");

  lines.push("## How To Run (Best Guess)");
  lines.push("");
  const verifiedCommands = summary.tryRun?.executions || [];
  const discoveryBuckets = deriveDeterministicDiscoveryBuckets(summary);
  const discoveredCommands = deriveDeterministicDiscoveredCommands(summary);
  const suggestedNotVerified = collectSuggestedNotVerified(discoveredCommands, verifiedCommands);

  lines.push("### Recommended (Verified)");
  lines.push("");
  if (verifiedCommands.length > 0) {
    for (const execution of verifiedCommands) {
      const commandText = `${execution.command}${execution.args.length ? ` ${execution.args.join(" ")}` : ""}`;
      const verification = runVerificationLabel(execution);
      lines.push(`- \`${commandText}\` - ${verification}`);
      lines.push(`  - Evidence: ${sanitizeSnippet(execution.verificationEvidence)}`);
    }
    const startVerification = summarizeStartVerification(verifiedCommands);
    if (startVerification) {
      lines.push(`- Start verification: ${startVerification}`);
    }
  } else if (summary.tryRun) {
    lines.push("- Try-run ran, but no command execution records were captured.");
  } else {
    lines.push("- No verified commands (`--try-run` was not executed).");
  }
  lines.push("");

  lines.push("### Suggested (Not Verified)");
  lines.push("");
  if (suggestedNotVerified.length > 0) {
    for (const command of suggestedNotVerified) {
      lines.push(`- \`${command}\` (found by deterministic script detection, not executed)`);
    }
  } else {
    lines.push("- No additional deterministic commands pending verification.");
  }
  lines.push("");

  lines.push("### Deterministic Discovery");
  lines.push("");
  lines.push(`- Install candidates: ${discoveryBuckets.install.length ? discoveryBuckets.install.map((cmd) => `\`${cmd}\``).join(", ") : "none"}`);
  lines.push(`- Test candidates: ${discoveryBuckets.test.length ? discoveryBuckets.test.map((cmd) => `\`${cmd}\``).join(", ") : "none"}`);
  lines.push(`- Run candidates: ${discoveryBuckets.run.length ? discoveryBuckets.run.map((cmd) => `\`${cmd}\``).join(", ") : "none"}`);
  lines.push("");

  lines.push("### Recommended");
  lines.push("");
  if (runRecommendation) {
    lines.push(`- \`${runRecommendation.command}\``);
    lines.push(`- Reason: ${runRecommendation.reason}`);
    lines.push(`- Based on: ${runRecommendation.evidence}`);
  } else {
    lines.push("- No single command recommendation could be made.");
  }
  lines.push("");
  lines.push(
    `- **Confidence:** ${runConfidence.toFixed(2)} (${runEvidence.length} evidence point${runEvidence.length === 1 ? "" : "s"})`,
  );
  lines.push("");
  appendEvidenceBlock(lines, runEvidence, 4);
  lines.push("");

  lines.push("## Configuration / Env Vars (Best Guess)");
  lines.push("");
  lines.push("- Detection method: code patterns (`process.env`/`os.getenv`) + `.env.example` + README mentions.");
  lines.push("");
  const requiredEnv = input.envAnalysis.required;
  const requiredByFlags = input.envAnalysis.requiredByFlags;
  const optionalEnv = input.envAnalysis.optional;
  const mentionedEnv = input.envAnalysis.mentioned;

  lines.push("### Required (Always)");
  lines.push("");
  if (requiredEnv.length > 0) {
    for (const hint of requiredEnv.slice(0, 20)) {
      lines.push(`- \`${hint.name}\` (confidence ${hint.confidence.toFixed(2)})`);
    }
  } else {
    lines.push("- No required env vars confidently detected.");
  }
  lines.push("");

  lines.push("### Required (Because Of Flags)");
  lines.push("");
  if (requiredByFlags.length > 0) {
    for (const hint of requiredByFlags.slice(0, 20)) {
      const triggers = extractFlagTriggers(hint.evidence);
      const triggerLabel = triggers.length > 0 ? `flags: ${triggers.join(", ")}, ` : "";
      lines.push(`- \`${hint.name}\` (${triggerLabel}confidence ${hint.confidence.toFixed(2)})`);
    }
  } else {
    lines.push("- No flag-scoped required env vars detected.");
  }
  lines.push("");

  lines.push("### Optional");
  lines.push("");
  if (optionalEnv.length > 0) {
    for (const hint of optionalEnv.slice(0, 20)) {
      lines.push(`- \`${hint.name}\` (confidence ${hint.confidence.toFixed(2)})`);
    }
  } else {
    lines.push("- No optional env vars detected.");
  }
  lines.push("");
  lines.push("### Mentioned In Docs");
  lines.push("");
  if (mentionedEnv.length > 0) {
    for (const hint of mentionedEnv.slice(0, 20)) {
      lines.push(`- \`${hint.name}\` (confidence ${hint.confidence.toFixed(2)})`);
    }
  } else {
    lines.push("- No env vars found only in docs/README.");
  }
  lines.push("");
  if (input.envAnalysis.filteredOut.length > 0) {
    lines.push(
      `- Filtered generic env vars (${input.envAnalysis.filteredOut.length}): ${input.envAnalysis.filteredOut
        .slice(0, 8)
        .join(", ")}`,
    );
    lines.push("");
  }
  lines.push(
    `- **Confidence:** ${envConfidence.toFixed(2)} (${envEvidence.length} evidence point${envEvidence.length === 1 ? "" : "s"})`,
  );
  lines.push("");
  appendEvidenceBlock(lines, envEvidence, 4);
  lines.push("");

  lines.push("## Architecture");
  lines.push("");
  lines.push(`- Nodes: ${summary.architecture.nodes.length}`);
  lines.push(`- Edges: ${summary.architecture.edges.length}`);
  lines.push("- Diagram: `architecture.mmd`");
  lines.push(
    `- Module map coverage: ${Math.round(summary.architecture.metrics.tsJsCoverage * 100)}% of TS/JS files parsed (${summary.architecture.metrics.tsJsParsedFiles}/${summary.architecture.metrics.tsJsSourceFiles})`,
  );
  lines.push("- Top modules by centrality:");
  for (const module of summary.architecture.topModules.slice(0, 8)) {
    lines.push(`- ${module.path} (degree ${module.degree})`);
  }
  if (summary.architecture.topModules.length > 0) {
    lines.push("- Hotspot reasons:");
    for (const module of summary.architecture.topModules.slice(0, 3)) {
      lines.push(`- ${module.path}: ${describeHotspotReason(summary.architecture, module.id)}`);
    }
  }
  lines.push("");
  lines.push("### Why These Hotspots Matter");
  lines.push("");
  lines.push("- Higher-degree modules often become change bottlenecks and can amplify regression risk.");
  lines.push("");
  lines.push("### Suggested Refactors");
  lines.push("");
  for (const module of summary.architecture.topModules.slice(0, 3)) {
    lines.push(`- ${module.path}: ${suggestRefactor(module.path, module.degree)}`);
  }
  lines.push("");
  lines.push(
    `- **Confidence:** ${architectureConfidence.toFixed(2)} (${architectureEvidence.length} evidence point${architectureEvidence.length === 1 ? "" : "s"})`,
  );
  lines.push("");
  appendEvidenceBlock(lines, architectureEvidence, 4);
  lines.push("");

  lines.push("## Risks");
  lines.push("");
  lines.push(`- License detected: ${input.detectedLicense || "none"}`);
  lines.push(`- Severity counts: high=${risksBySeverity.high}, med=${risksBySeverity.med}, low=${risksBySeverity.low}`);
  lines.push("- Full details: `risks.md` and `risks.json`");
  if (riskIssues.length > 0) {
    lines.push("");
    lines.push("Top risk issues:");
    for (const issue of riskIssues) {
      lines.push(`- **${issue.title}** (severity=${issue.severity}, confidence=${issue.confidence.toFixed(2)})`);
    }
  }
  lines.push("");

  lines.push("## Where To Improve");
  lines.push("");
  lines.push(`- Improvement counts: high=${improveCounts.high}, med=${improveCounts.med}, low=${improveCounts.low}`);
  lines.push(`- Formatting: ${formatFormattingStatus(input.formatting)}`);
  if (input.formatting.evidence.length > 0) {
    const evidence = input.formatting.evidence[0];
    lines.push(`- Formatting evidence: ${evidence.path} (${sanitizeSnippet(evidence.snippet)})`);
  }
  if (improveIssues.length === 0) {
    lines.push("- No improvement suggestions generated.");
  } else {
    for (const issue of improveIssues) {
      lines.push(`- **${issue.title}** (severity=${issue.severity}, confidence=${issue.confidence.toFixed(2)})`);
      lines.push(`  - Evidence: ${summarizeIssueEvidence(issue)}`);
      lines.push(`  - Action: ${buildImproveAction(issue)}`);
    }
  }
  lines.push("");

  lines.push("## Suggested Issues (Top 5)");
  lines.push("");
  if (topIssues.length === 0) {
    lines.push("- No issues generated.");
  } else {
    for (const issue of topIssues) {
      lines.push(`- **${issue.title}** (severity=${issue.severity}, confidence=${issue.confidence.toFixed(2)})`);
    }
  }
  lines.push("");

  lines.push("## Try-Run Results");
  lines.push("");
  if (summary.tryRun) {
    lines.push(`- ${summary.tryRun.summary}`);
    lines.push("- See `Try-Run Summary` above for command-level verification.");
    lines.push("- Details: `run_attempt.md`");
  } else {
    lines.push("- Try-run was not executed (`--try-run` disabled).");
  }
  lines.push("");

  lines.push("## Deliverables");
  lines.push("");
  lines.push("- `report.md` / `report.json`");
  lines.push("- `architecture.mmd` / `architecture.json`");
  lines.push("- `risks.md` / `risks.json`");
  lines.push("- `issues.json` / `issues.good-first.md` / `issues.good-first.json`");
  lines.push("- `README_2.0.md`");
  if (summary.tryRun) {
    lines.push("- `run_attempt.md` / `run_attempt.json`");
  }
  if (input.prDraftEnabled) {
    lines.push("- `pr_draft.md`");
    lines.push("- PR draft title: `chore: improve repo reliability, docs, and architecture hygiene`");
    lines.push(
      `- PR draft planned changes: ${summary.issues
        .slice(0, 3)
        .map((issue) => issue.title)
        .join(" | ") || "No prioritized issues."}`,
    );
  }
  lines.push("- `logs.jsonl` / `file_index.json`");
  lines.push("");

  lines.push("## LLM Note");
  lines.push("");
  lines.push(input.llmUsed ? "- LLM-assisted text generation enabled; verify instructions." : "- LLM mode disabled.");
  lines.push("");

  lines.push("## Next 3 Actions");
  lines.push("");
  if (nextActions.length === 0) {
    lines.push("1. No immediate action required from current heuristics.");
  } else {
    for (let i = 0; i < nextActions.length; i += 1) {
      const issue = nextActions[i];
      lines.push(`${i + 1}. ${issue.title} (severity=${issue.severity}, confidence=${issue.confidence.toFixed(2)})`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

export function renderRisksMarkdown(input: {
  repoIdentity: RepoIdentity;
  generatedAt: string;
  config: ConfigSnapshot;
  risks: RiskItem[];
}): string {
  const lines: string[] = [];
  lines.push("# RepoSherlock Risk Report");
  lines.push("");
  lines.push(renderMetadataBlock(input.repoIdentity, input.generatedAt, input.config));
  lines.push("");
  lines.push("> Lightweight checks only. Potential risk does not imply confirmed vulnerability.");
  lines.push("");

  if (input.risks.length === 0) {
    lines.push("No risks detected by configured heuristics.");
    return lines.join("\n");
  }

  for (const risk of input.risks) {
    lines.push(`## ${risk.title}`);
    lines.push("");
    lines.push(`- Category: ${risk.category}`);
    lines.push(`- Severity: ${risk.severity}`);
    lines.push(`- Confidence: ${risk.confidence.toFixed(2)}`);
    lines.push(`- Description: ${risk.description}`);
    lines.push("- Evidence:");
    for (const ev of risk.evidence.slice(0, 20)) {
      lines.push(`- ${ev}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function renderReadme20Markdown(input: {
  summary: DeterministicSummary;
  likelyPurpose: string;
  envHints: string[];
  envAnalysis?: EnvAnalysis;
  config: ConfigSnapshot;
  llmUsed: boolean;
}): string {
  const s = input.summary;
  const lines: string[] = [];
  lines.push(`# ${s.repoIdentity.displayName} - README 2.0 Draft`);
  lines.push("");
  lines.push(renderMetadataBlock(s.repoIdentity, s.generatedAt, input.config));
  lines.push("");
  if (input.llmUsed) {
    lines.push("> LLM-assisted text generation enabled; verify instructions.");
    lines.push("");
  }

  lines.push("## Overview");
  lines.push("");
  lines.push(input.likelyPurpose);
  lines.push("");

  lines.push("## Quickstart");
  lines.push("");
  lines.push("```bash");
  for (const cmd of s.runGuess.installCommands.slice(0, 3)) {
    lines.push(cmd);
  }
  for (const cmd of s.runGuess.runCommands.slice(0, 2)) {
    lines.push(cmd);
  }
  if (s.runGuess.installCommands.length === 0 && s.runGuess.runCommands.length === 0) {
    lines.push("# No deterministic quickstart command detected");
  }
  lines.push("```");
  lines.push("");

  lines.push("## Usage");
  lines.push("");
  if (s.keyFiles.entrypoints.length) {
    lines.push("Primary entrypoints detected:");
    for (const entry of s.keyFiles.entrypoints.slice(0, 8)) {
      lines.push(`- \`${entry}\``);
    }
  } else {
    lines.push("No entrypoint files confidently detected.");
  }
  lines.push("");

  lines.push("## Configuration");
  lines.push("");
  const required = input.envAnalysis?.required || [];
  const optional = input.envAnalysis?.optional || [];
  const mentioned = input.envAnalysis?.mentioned || [];
  if (required.length > 0) {
    lines.push("Required vars:");
    for (const env of required.slice(0, 20)) {
      lines.push(`- \`${env.name}\``);
    }
    lines.push("");
  }
  if (optional.length > 0) {
    lines.push("Optional vars:");
    for (const env of optional.slice(0, 20)) {
      lines.push(`- \`${env.name}\``);
    }
    lines.push("");
  }
  if (mentioned.length > 0) {
    lines.push("Mentioned in docs:");
    for (const env of mentioned.slice(0, 20)) {
      lines.push(`- \`${env.name}\``);
    }
    lines.push("");
  }
  if (required.length === 0 && optional.length === 0 && mentioned.length === 0) {
    if (input.envHints.length) {
      for (const env of input.envHints.slice(0, 40)) {
        lines.push(`- \`${env}\``);
      }
    } else {
      lines.push("- No required env vars confidently inferred.");
    }
    lines.push("");
  }

  lines.push("## Troubleshooting");
  lines.push("");
  lines.push("- If dependencies fail to install, align runtime versions with lockfiles.");
  lines.push("- If startup fails, verify required environment variables and ports.");
  lines.push("- Check `run_attempt.md` (if generated) for captured errors and probable fixes.");
  lines.push("");

  lines.push("## Disclaimer");
  lines.push("");
  lines.push("This README is generated heuristically and should be reviewed by maintainers.");

  return lines.join("\n");
}

export function renderRunAttemptMarkdown(input: {
  repoIdentity: RepoIdentity;
  generatedAt: string;
  config: ConfigSnapshot;
  result: RunAttemptResult;
}): string {
  const lines: string[] = [];
  lines.push("# RepoSherlock Try-Run Sandbox Pass");
  lines.push("");
  lines.push(renderMetadataBlock(input.repoIdentity, input.generatedAt, input.config));
  lines.push("");
  lines.push("> Try-run is opt-in and executed with timeouts/output caps in a temporary copy.");
  lines.push("");

  lines.push("## Plan");
  lines.push("");
  lines.push(`- Strategy: ${input.result.planner.strategy}`);
  lines.push(`- Reason: ${input.result.planner.reason}`);
  if (input.result.planner.proposedCommands.length) {
    lines.push("- Proposed commands:");
    for (const cmd of input.result.planner.proposedCommands) {
      lines.push(`- \`${cmd}\``);
    }
  } else {
    lines.push("- No proposed commands.");
  }
  lines.push("");

  lines.push("## Execution Table");
  lines.push("");
  if (input.result.executions.length === 0) {
    lines.push("No commands were executed.");
  } else {
    lines.push("| Step | Command | Status | Exit | Time | Note |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const exec of input.result.executions) {
      const step = exec.step;
      const commandText = `${exec.command}${exec.args.length ? ` ${exec.args.join(" ")}` : ""}`;
      const status = runVerificationLabel(exec);
      const exit = exec.timedOut ? "timeout" : String(exec.exitCode ?? "null");
      const duration = `${(exec.durationMs / 1000).toFixed(1)}s`;
      const note = buildTryRunNote(exec);
      lines.push(`| ${escapeTable(step)} | \`${escapeTable(commandText)}\` | ${escapeTable(status)} | ${escapeTable(exit)} | ${escapeTable(duration)} | ${escapeTable(note)} |`);
    }
    lines.push("");
    lines.push("- Legend: `verified`=confirmed signal, `partial`=weak/indirect signal, `failed`=execution failed, `skipped`=not executed.");
    lines.push("");
    lines.push("### Try-Run Evidence (snippets)");
    lines.push("");
    for (const exec of input.result.executions) {
      lines.push(`- ${exec.step}: "${sanitizeSnippet(extractRunEvidenceSnippet(exec))}"`);
    }
  }
  lines.push("");

  lines.push("## Executions");
  lines.push("");
  if (input.result.executions.length === 0) {
    lines.push("No commands were executed.");
  } else {
    for (const exec of input.result.executions) {
      lines.push(renderExecution(exec));
      lines.push("");
    }
  }

  lines.push("## Summary");
  lines.push("");
  lines.push(`- ${input.result.summary}`);
  const startVerification = summarizeStartVerification(input.result.executions);
  if (startVerification) {
    lines.push(`- Start verification: ${startVerification}`);
  }
  return lines.join("\n");
}

function renderExecution(exec: CommandExecution): string {
  const lines: string[] = [];
  lines.push(`### ${exec.command} ${exec.args.join(" ")}`.trim());
  lines.push("");
  lines.push(`- Exit code: ${exec.exitCode}`);
  lines.push(`- Timed out: ${exec.timedOut}`);
  lines.push(`- Duration: ${exec.durationMs}ms`);
  lines.push(`- Step: ${exec.step}`);
  lines.push(`- Help mode: ${exec.helpMode ? "yes" : "no"}`);
  lines.push(`- Classification: ${exec.classification}`);
  lines.push(`- Verification: ${exec.verificationStatus} (${exec.verificationEvidence})`);
  const portHint = detectPort(exec.stdoutSnippet) || detectPort(exec.stderrSnippet);
  if (portHint) {
    lines.push(`- Listening port hint: ${portHint}`);
  }
  if (exec.probableFixes.length) {
    lines.push("- Probable fixes:");
    for (const fix of exec.probableFixes) {
      lines.push(`- ${fix}`);
    }
  }
  if (exec.stderrSnippet) {
    lines.push("- Stderr snippet:");
    lines.push("```text");
    lines.push(trimBlock(exec.stderrSnippet, 2500));
    lines.push("```");
  }
  if (exec.stdoutSnippet) {
    lines.push("- Stdout snippet:");
    lines.push("```text");
    lines.push(trimBlock(exec.stdoutSnippet, 1500));
    lines.push("```");
  }

  return lines.join("\n");
}

export function renderIssuesAsMarkdown(issue: IssueItem): string {
  return `# ${issue.title}\n\n${issue.body}\n\n- severity: ${issue.severity}\n- confidence: ${issue.confidence.toFixed(
    2,
  )}\n- labels: ${issue.labels.join(", ")}`;
}

export function renderGoodFirstIssuesMarkdown(input: {
  repoIdentity: RepoIdentity;
  generatedAt: string;
  config: ConfigSnapshot;
  issues: IssueItem[];
}): string {
  const lines: string[] = [];
  lines.push("# RepoSherlock Good First Issues");
  lines.push("");
  lines.push(renderMetadataBlock(input.repoIdentity, input.generatedAt, input.config));
  lines.push("");
  lines.push("> Candidate starter tasks with lower complexity and clear evidence.");
  lines.push("");

  if (input.issues.length === 0) {
    lines.push("No good-first issues identified.");
    return lines.join("\n");
  }

  for (const issue of input.issues) {
    lines.push(`## ${issue.title}`);
    lines.push("");
    lines.push(`- Severity: ${issue.severity}`);
    lines.push(`- Confidence: ${issue.confidence.toFixed(2)}`);
    lines.push(`- Labels: ${issue.labels.join(", ")}`);
    lines.push("- Evidence:");
    for (const ev of issue.evidence.slice(0, 8)) {
      lines.push(`- ${ev}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function renderPrDraftMarkdown(input: {
  repoIdentity: RepoIdentity;
  generatedAt: string;
  config: ConfigSnapshot;
  issues: IssueItem[];
  goodFirst: IssueItem[];
}): string {
  const top = input.issues.slice(0, 5);
  const lines: string[] = [];
  lines.push("# PR Draft");
  lines.push("");
  lines.push(renderMetadataBlock(input.repoIdentity, input.generatedAt, input.config));
  lines.push("");
  lines.push("## Title");
  lines.push("");
  lines.push("chore: improve repo reliability, docs, and architecture hygiene");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("This PR addresses findings from RepoSherlock analysis and improves runability, docs clarity, and maintainability.");
  lines.push("");
  lines.push("## Changes");
  lines.push("");
  if (top.length === 0) {
    lines.push("- No prioritized issues were available.");
  } else {
    for (const issue of top) {
      lines.push(`- [ ] ${issue.title} (severity=${issue.severity}, confidence=${issue.confidence.toFixed(2)})`);
    }
  }
  lines.push("");
  lines.push("## Good First Issues");
  lines.push("");
  if (input.goodFirst.length === 0) {
    lines.push("- None identified.");
  } else {
    for (const issue of input.goodFirst.slice(0, 5)) {
      lines.push(`- ${issue.title}`);
    }
  }
  lines.push("");
  lines.push("## Validation Checklist");
  lines.push("");
  lines.push("- [ ] Build passes");
  lines.push("- [ ] Tests pass");
  lines.push("- [ ] README quickstart verified");
  lines.push("- [ ] No secrets exposed in outputs");
  lines.push("");

  return lines.join("\n");
}

function renderMetadataBlock(repo: RepoIdentity, generatedAt: string, config: ConfigSnapshot): string {
  const configSnapshot = JSON.stringify(config.analyzeOptions);
  return [
    "```yaml",
    `generated_at: ${generatedAt}`,
    `repo_input: ${repo.input}`,
    `repo_name: ${repo.displayName}`,
    `repo_source: ${repo.sourceType}`,
    `tool_version: ${config.toolVersion}`,
    `config_snapshot: '${configSnapshot.replace(/'/g, "''")}'`,
    "```",
  ].join("\n");
}

function escapeMermaidLabel(value: string): string {
  return value.replace(/"/g, "\\\"");
}

function trimBlock(value: string, maxChars: number): string {
  return value.length > maxChars ? value.slice(value.length - maxChars) : value;
}

function appendEvidenceBlock(lines: string[], evidence: EvidenceRef[], max = 4): void {
  if (evidence.length === 0) {
    lines.push("_Evidence unavailable for this claim._");
    return;
  }

  lines.push("Evidence:");
  for (const item of evidence.slice(0, max)) {
    lines.push(`- Source: ${item.source} | Path: \`${item.path}\` | Snippet: \`${sanitizeSnippet(item.snippet)}\``);
  }
}

function sanitizeSnippet(value: string): string {
  return value.replace(/`/g, "'").replace(/\s+/g, " ").trim().slice(0, 140);
}

function confidenceFromEvidence(base: number, evidenceCount: number): number {
  const adjusted = Math.min(0.98, base + Math.min(6, evidenceCount) * 0.03);
  return Number(adjusted.toFixed(2));
}

function countBySeverity(items: Severity[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { high: 0, med: 0, low: 0 };
  for (const severity of items) {
    counts[severity] += 1;
  }
  return counts;
}

function severityRank(value: Severity): number {
  if (value === "high") return 3;
  if (value === "med") return 2;
  return 1;
}

function pickNextActions(issues: IssueItem[], maxCount: number): IssueItem[] {
  const ranked = issues
    .slice()
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.confidence - a.confidence);
  return ranked.slice(0, maxCount);
}

function isRiskIssue(issue: IssueItem): boolean {
  const labels = issue.labels.map((label) => label.toLowerCase());
  return labels.some(
    (label) =>
      label.includes("category:license") ||
      label.includes("category:secret") ||
      label.includes("category:dependency") ||
      label.includes("category:ci"),
  );
}

function isImproveIssue(issue: IssueItem): boolean {
  const labels = issue.labels.map((label) => label.toLowerCase());
  if (isRiskIssue(issue)) {
    return false;
  }
  return labels.some(
    (label) => label.includes("documentation") || label.includes("category:quality") || label.includes("architecture"),
  );
}

function suggestRefactor(modulePath: string, degree: number): string {
  const lower = modulePath.toLowerCase();
  if (lower.endsWith("/types.ts") || lower.includes("/types.")) {
    return `Split into \`src/types/{core,cli,pipeline,risk,output}.ts\` and re-export stable surface from \`src/types.ts\` (degree ${degree}).`;
  }
  if (lower.includes("analyzepipeline")) {
    return `Split stage contracts and orchestration helpers into smaller pipeline modules to reduce coupling (degree ${degree}).`;
  }
  if (lower.endsWith("/fs.ts") || lower.includes("/utils/fs")) {
    return `Separate IO-heavy functions from path/string helpers to reduce fan-in (degree ${degree}).`;
  }
  if (lower.includes("index")) {
    return `Reduce index barrel fan-in by importing concrete modules directly where possible (degree ${degree}).`;
  }
  return `Review responsibilities and extract smaller units to lower coupling (degree ${degree}).`;
}

function recommendRunCommand(
  summary: DeterministicSummary,
  runEvidence: EvidenceRef[],
): { command: string; reason: string; evidence: string } | null {
  const runCommands = summary.runGuess.runCommands;
  if (runCommands.length === 0) {
    return null;
  }

  const pickByToken = (token: string): string | null => runCommands.find((cmd) => cmd.toLowerCase().includes(token)) || null;
  const projectType = summary.classification.projectType;

  let chosen: string | null = null;
  let reason = "";
  if (projectType === "web" || projectType === "app" || projectType === "service") {
    chosen = pickByToken(" run dev") || pickByToken(" start") || runCommands[0];
    reason = chosen.includes("dev")
      ? "development entrypoint detected for interactive workflow"
      : "runtime start command selected as primary execution path";
  } else if (projectType === "cli") {
    chosen = pickByToken(" start") || runCommands[0];
    reason = "CLI project detected; selected primary executable command";
  } else {
    chosen = runCommands[0];
    reason = "first deterministic runnable command";
  }

  const evidence =
    runEvidence
      .find((item) => /scripts\.(dev|start|build|test)/i.test(item.snippet))
      ?.snippet.replace(/^scripts\./, "package.json#scripts.") || "deterministic run-guess heuristics";

  return { command: chosen, reason, evidence };
}

function formatFormattingStatus(formatting: FormattingInsight): string {
  if (formatting.detectedTools.length === 0) {
    if (formatting.ecosystem === "python") {
      if (formatting.hasFormatScript) {
        return "tool unknown (format target exists but no ruff/black/isort/yapf/autopep8 config was detected).";
      }
      return "none detected (no ruff/black/isort/yapf/autopep8/flake8/mypy signal and no format target).";
    }
    if (formatting.hasFormatScript) {
      return "tool unknown (format script exists but no prettier/biome/eslint dependency or config file was detected).";
    }
    return "none detected (no prettier/biome/eslint deps, no formatter config, no format script).";
  }

  const deps = formatting.dependencyTools.length ? formatting.dependencyTools.join(", ") : "none";
  const configs = formatting.configFiles.length ? formatting.configFiles.join(", ") : "none";
  const scripts = formatting.formatScriptNames.length ? formatting.formatScriptNames.join(", ") : "none";
  return `tools=${formatting.detectedTools.join(", ")}; dependency-signal=${deps}; config-files=${configs}; format-scripts=${scripts}.`;
}

function appendTryRunSummary(lines: string[], executions: CommandExecution[]): void {
  lines.push("## Try-Run Summary");
  lines.push("");
  if (executions.length === 0) {
    lines.push("- Try-run enabled, but no executable commands were selected.");
    return;
  }

  lines.push("| Step | Command | Status | Exit | Time | Note |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const execution of executions) {
    const commandText = `${execution.command}${execution.args.length ? ` ${execution.args.join(" ")}` : ""}`;
    const status = runVerificationLabel(execution);
    const exit = execution.timedOut ? "timeout" : String(execution.exitCode ?? "null");
    const time = `${(execution.durationMs / 1000).toFixed(1)}s`;
    const note = buildTryRunNote(execution);
    lines.push(
      `| ${escapeTable(execution.step)} | \`${escapeTable(commandText)}\` | ${escapeTable(status)} | ${escapeTable(exit)} | ${escapeTable(time)} | ${escapeTable(note)} |`,
    );
  }
  lines.push("");
  lines.push("- Legend: `verified`=confirmed signal, `partial`=weak/indirect signal, `failed`=execution failed, `skipped`=not executed.");
  lines.push("");
  lines.push("### Try-Run Evidence (snippets)");
  lines.push("");
  for (const execution of executions) {
    lines.push(`- ${execution.step}: "${sanitizeSnippet(extractRunEvidenceSnippet(execution))}"`);
  }
}

function extractRunEvidenceSnippet(exec: CommandExecution): string {
  if (exec.verificationEvidence) {
    return exec.verificationEvidence;
  }

  const port = detectPort(exec.stdoutSnippet) || detectPort(exec.stderrSnippet);
  if (port) {
    return `listening on port ${port}`;
  }

  const log = `${exec.stderrSnippet}\n${exec.stdoutSnippet}`.replace(/\s+/g, " ").trim();
  if (!log) {
    return exec.timedOut ? "timed out without parsable log evidence" : "no concise runtime evidence found";
  }

  const signalMatch =
    log.match(/(?:compiled|built|ready|listening|running|passed|success|installed)[^.;:]{0,120}/i) ||
    log.match(/(?:error|failed|exception)[^.;:]{0,120}/i);
  if (signalMatch) {
    return signalMatch[0].trim();
  }

  return log.slice(0, 120);
}

function summarizeStartVerification(executions: CommandExecution[]): string | null {
  const startCandidates = executions.filter((execution) => execution.step === "start");
  const startExecution = startCandidates.length > 0 ? startCandidates[startCandidates.length - 1] : undefined;
  if (!startExecution) {
    return "not attempted";
  }
  if (startExecution.timedOut) {
    return "not validated (timeout)";
  }
  if (startExecution.verificationStatus === "failed") {
    return "not validated (failed)";
  }
  if (startExecution.helpMode) {
    return "help output only (server startup not validated)";
  }
  if (startExecution.verificationStatus === "verified") {
    return startExecution.verificationEvidence;
  }
  if (startExecution.verificationStatus === "partial") {
    return `${startExecution.verificationEvidence} (partial)`;
  }
  return startExecution.verificationEvidence;
}

function collectSuggestedNotVerified(
  discoveredCommands: string[],
  executions: CommandExecution[],
): string[] {
  const executedNormalized = new Set(
    executions.map((execution) => normalizeCommand(`${execution.command} ${execution.args.join(" ")}`)),
  );
  const suggested: string[] = [];
  for (const command of discoveredCommands) {
    if (!isAllowedDeterministicCommand(command)) {
      continue;
    }
    if (!executedNormalized.has(normalizeCommand(command))) {
      suggested.push(command);
    }
  }
  return Array.from(new Set(suggested));
}

function normalizeCommand(command: string): string {
  return command.replace(/\s+/g, " ").trim().toLowerCase();
}

function runVerificationLabel(execution: CommandExecution): string {
  return execution.verificationStatus;
}

function summarizeIssueEvidence(issue: IssueItem): string {
  if (issue.evidence.length === 0) {
    return "No direct evidence captured.";
  }
  return sanitizeSnippet(issue.evidence[0]);
}

function buildImproveAction(issue: IssueItem): string {
  const title = issue.title.toLowerCase();
  if (title.includes(".env.example")) {
    return "Create `.env.example` and map required keys with one-line descriptions in README quickstart.";
  }
  if (title.includes("formatting") || title.includes("format script")) {
    if (title.includes("python")) {
      return "Add Ruff or Black configuration (plus isort if needed) and expose a `make format` target for contributors.";
    }
    return "Add Biome or Prettier config, then expose `format` script in package.json for one-command formatting.";
  }
  if (title.includes("high-centrality module")) {
    const modulePath = issue.title.split(":").slice(1).join(":").trim();
    if (modulePath.endsWith("src/types.ts")) {
      return "Split `src/types.ts` into `src/types/{core,cli,pipeline,risk,output}.ts` and re-export via `src/types.ts`.";
    }
    if (modulePath) {
      return `Split \`${modulePath}\` into domain-focused files and keep a thin public entrypoint.`;
    }
  }
  return "Convert this finding into a scoped PR with tests/docs updated alongside code changes.";
}

function describeHotspotReason(architecture: ArchitectureMap, moduleId: string): string {
  let fanIn = 0;
  let fanOut = 0;
  for (const edge of architecture.edges) {
    if (edge.to === moduleId) fanIn += 1;
    if (edge.from === moduleId) fanOut += 1;
  }

  if (fanIn > 0 && fanOut > 0) {
    return `high fan-in (${fanIn}) + fan-out (${fanOut}) across local modules`;
  }
  if (fanIn > 0) {
    return `high fan-in (${fanIn}) from multiple modules`;
  }
  if (fanOut > 0) {
    return `high fan-out (${fanOut}) touching many modules`;
  }
  return "central by degree but without strong directional edge dominance";
}

function extractFlagTriggers(evidence: EvidenceRef[]): string[] {
  const triggers = new Set<string>();
  for (const item of evidence) {
    const snippet = `${item.source} ${item.path} ${item.snippet}`;
    const matches = snippet.match(/--[a-z0-9-]+/gi) || [];
    for (const match of matches) {
      triggers.add(match.toLowerCase());
    }
    if (/llm mode is enabled|llm-mandatory/i.test(snippet)) {
      triggers.add("--llm-mandatory");
    }
  }
  return Array.from(triggers);
}

function estimateTsJsFilesWithEdges(architecture: ArchitectureMap): number {
  const files = new Set<string>();
  for (const edge of architecture.edges) {
    if (!edge.from.endsWith(".py")) files.add(edge.from);
    if (!edge.to.endsWith(".py")) files.add(edge.to);
  }
  return files.size;
}

function detectPort(output: string): string | null {
  if (!output) return null;
  const match =
    output.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/i) ||
    output.match(/listening(?:\s+on)?(?:\s+port)?\s+(\d{2,5})/i) ||
    output.match(/port\s+(\d{2,5})/i);
  if (!match) return null;
  return match[1] || null;
}

function buildTryRunNote(execution: CommandExecution): string {
  if (execution.verificationStatus === "skipped") {
    return "not executed";
  }
  if (execution.helpMode && execution.step === "start") {
    return "help-only";
  }
  if (execution.verificationStatus === "failed") {
    return "command failed";
  }
  return summarizeShortEvidence(extractRunEvidenceSnippet(execution), 38);
}

function summarizeShortEvidence(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1)}…`;
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function deriveDeterministicDiscoveredCommands(summary: DeterministicSummary): string[] {
  if (summary.tryRun?.planner.proposedCommands?.length) {
    return summary.tryRun.planner.proposedCommands.slice();
  }
  return [
    ...summary.runGuess.installCommands,
    ...summary.runGuess.testCommands,
    ...summary.runGuess.runCommands,
  ];
}

function isAllowedDeterministicCommand(command: string): boolean {
  const normalized = normalizeCommand(command);
  if (/^bun install$/.test(normalized)) return true;
  if (/^bun run [a-z0-9:_-]+(\s+--\s+--help)?$/.test(normalized)) return true;

  if (/^npm (ci|install|test)$/.test(normalized)) return true;
  if (/^npm run [a-z0-9:_-]+(\s+--\s+--help)?$/.test(normalized)) return true;

  if (/^pnpm (install|test)$/.test(normalized)) return true;
  if (/^pnpm run [a-z0-9:_-]+(\s+--\s+--help)?$/.test(normalized)) return true;

  if (/^yarn (install|test)$/.test(normalized)) return true;
  if (/^yarn run [a-z0-9:_-]+(\s+--\s+--help)?$/.test(normalized)) return true;
  if (/^yarn [a-z0-9:_-]+(\s+--\s+--help)?$/.test(normalized)) return true;

  if (normalized.startsWith("docker ")) return true;
  if (normalized.startsWith("python ")) return true;
  if (normalized === "pytest") return true;
  if (/^make [a-z0-9:_-]+$/.test(normalized)) return true;
  return false;
}

function splitEntrypoints(paths: string[]): { runtime: string[]; library: string[] } {
  const cleaned = paths.filter((entry) => !isTestOrFixturePath(entry));
  const runtime: string[] = [];
  const library: string[] = [];

  for (const entry of cleaned) {
    if (isRuntimeEntrypoint(entry)) {
      runtime.push(entry);
    } else {
      library.push(entry);
    }
  }

  return {
    runtime: unique(runtime),
    library: unique(library),
  };
}

function isRuntimeEntrypoint(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/").toLowerCase();
  return (
    normalized.includes("/cli.") ||
    normalized.endsWith("/cli.ts") ||
    normalized.endsWith("/cli.js") ||
    normalized.includes("/commands/") ||
    normalized.includes("/server.") ||
    normalized.endsWith("/main.ts") ||
    normalized.endsWith("/main.js") ||
    normalized.endsWith("/app.ts") ||
    normalized.endsWith("/app.js") ||
    normalized.includes("/bin/")
  );
}

function isTestOrFixturePath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/").toLowerCase();
  return /(^|\/)(test|tests|__tests__|spec|specs|fixture|fixtures|example|examples)(\/|$)/.test(normalized);
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items));
}

function deriveDeterministicDiscoveryBuckets(summary: DeterministicSummary): {
  install: string[];
  test: string[];
  run: string[];
} {
  if (!summary.tryRun?.planner.proposedCommands?.length) {
    return {
      install: summary.runGuess.installCommands.slice(),
      test: summary.runGuess.testCommands.slice(),
      run: summary.runGuess.runCommands.slice(),
    };
  }

  const buckets = { install: [] as string[], test: [] as string[], run: [] as string[] };
  for (const command of summary.tryRun.planner.proposedCommands) {
    const normalized = normalizeCommand(command);
    if (
      /\b(ci|install)\b/.test(normalized) ||
      normalized.startsWith("python -m pip install") ||
      normalized.startsWith("docker build")
    ) {
      pushUnique(buckets.install, command);
      continue;
    }
    if (
      normalized === "pytest" ||
      /\btest\b/.test(normalized)
    ) {
      pushUnique(buckets.test, command);
      continue;
    }
    pushUnique(buckets.run, command);
  }
  return buckets;
}

function pushUnique(items: string[], value: string): void {
  if (!items.includes(value)) {
    items.push(value);
  }
}

export function createConfigSnapshot(options: AnalyzeOptions): ConfigSnapshot {
  const safeOptions: AnalyzeOptions = {
    ...options,
    llmApiKey: undefined,
  };
  return {
    analyzeOptions: safeOptions,
    generatedAt: new Date().toISOString(),
    toolVersion: "0.1.0",
  };
}
