import type { CommandExecution, DeterministicSummary, Severity } from "../types.js";
import { getUiRuntime, resetUiRuntime, setAnimationOverride } from "../ui/runtime.js";
import { ThinkingPanel } from "../ui/thinkingPanel.js";
import { StageRunner } from "../ui/stageRunner.js";
import { CINEMATIC_PANEL_WIDTH } from "../ui/layout.js";

interface StageStartOptions {
  hints?: string[];
}

interface RunPlanPanelInput {
  target: string;
  llmEnabled: boolean;
  llmMandatory?: boolean;
  provider?: string;
  model?: string;
  tryRun: boolean;
  prDraft: boolean;
}

const state = {
  introShown: false,
};

export function setConsoleAnimation(enabled: boolean): void {
  setAnimationOverride(enabled);
  resetUiRuntime();
}

export function getStageRunner(): StageRunner {
  return getUiRuntime().stageRunner;
}

export function resetUiForRun(): void {
  const ui = getUiRuntime();
  ui.scheduler.resetRun();
  ui.stageRunner.resetRun();
}

export function printRunPlanPanel(input: RunPlanPanelInput): void {
  const ui = getUiRuntime();
  const llmLabel = input.llmEnabled
    ? input.llmMandatory
      ? "enabled (mandatory)"
      : "enabled"
    : "disabled";

  const provider = input.provider || "n/a";
  const model = input.model || "n/a";
  const tryRun = input.tryRun ? "enabled" : "disabled";
  const prDraft = input.prDraft ? "enabled" : "disabled";

  ui.renderer.panel(
    "Run Plan",
    [
      `Target: ${input.target}`,
      `LLM: ${llmLabel}   Provider: ${provider}   Model: ${model}`,
      `Try-Run: ${tryRun}   PR Draft: ${prDraft}`,
      `${ui.theme.symbols.tick} Starting analysis...`,
    ],
    { width: CINEMATIC_PANEL_WIDTH },
  );
}

export async function showSherlockIntro(version: string): Promise<void> {
  const ui = getUiRuntime();
  if (state.introShown || ui.capabilities.quiet) {
    return;
  }
  state.introShown = true;
  const headerLine = "══════════════════════════════════════════════════════════════════════";
  const welcome = ` Welcome to RepoSherlock v${version} `;
  const title = [
    " ███████╗██╗  ██╗███████╗██████╗ ██╗      ██████╗  ██████╗██╗  ██╗",
    " ██╔════╝██║  ██║██╔════╝██╔══██╗██║     ██╔═══██╗██╔════╝██║ ██╔╝",
    " ███████╗███████║█████╗  ██████╔╝██║     ██║   ██║██║     █████╔╝ ",
    " ╚════██║██╔══██║██╔══╝  ██╔══██╗██║     ██║   ██║██║     ██╔═██╗ ",
    " ███████║██║  ██║███████╗██║  ██║███████╗╚██████╔╝╚██████╗██║  ██╗",
    " ╚══════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝",
  ];

  ui.renderer.line(ui.theme.colors.primary(headerLine));
  ui.renderer.line(ui.theme.colors.heading(welcome));
  ui.renderer.line(ui.theme.colors.primary(headerLine));
  ui.renderer.line();

  if (ui.capabilities.animations) {
    await ui.renderer.revealLines(title.map((line) => ui.theme.colors.primary(line)), {
      maxMs: 280,
      minStepMs: 18,
      maxStepMs: 30,
    });
  } else {
    for (const line of title) {
      ui.renderer.line(ui.theme.colors.primary(line));
    }
  }

  ui.renderer.line();
  ui.renderer.line(ui.theme.colors.ok("Drop a repo URL. Get answers fast."));
  ui.renderer.line();
}

export async function showSherlockThinking(lines?: string[]): Promise<void> {
  const ui = getUiRuntime();
  if (ui.capabilities.quiet) {
    return;
  }

  const steps = (lines && lines.length > 0
    ? lines
    : [
        "Validating repository target and runtime profile",
        "Planning scan strategy and safe execution path",
        "Preparing architecture, risk, and issue synthesis",
      ]).slice(0, 6);

  if (steps.length === 0) {
    return;
  }

  const panel = new ThinkingPanel(ui.renderer, ui.scheduler, ui.capabilities, ui.theme, {
    minPanelVisibleMs: ui.scheduler.minThinkingMs,
  });
  panel.start(steps);
  for (let i = 0; i < steps.length; i += 1) {
    panel.activate(i);
    await panel.complete(i);
  }
  await panel.stop({ finalize: true });
}

// Legacy API retained for backward compatibility.
export function printStageStart(stage: string, options?: StageStartOptions): number {
  const ui = getUiRuntime();
  if (!ui.capabilities.quiet) {
    const hint = options?.hints?.[0];
    ui.renderer.line(`[RepoSherlock] ${stage}${hint ? ` (${hint})` : ""}...`);
  }
  return Date.now();
}

export function printStageEnd(stage: string, startedAt: number): void {
  const ui = getUiRuntime();
  if (ui.capabilities.quiet) return;
  const duration = Date.now() - startedAt;
  ui.renderer.line(ui.theme.colors.ok(`${ui.theme.symbols.tick} [RepoSherlock] ${stage} done in ${duration}ms`));
}

export function printStageError(stage: string, startedAt: number, error: unknown): void {
  const ui = getUiRuntime();
  if (ui.capabilities.quiet) return;
  const duration = Date.now() - startedAt;
  const message = error instanceof Error ? error.message : String(error);
  ui.renderer.line(ui.theme.colors.err(`${ui.theme.symbols.cross} [RepoSherlock] ${stage} failed in ${duration}ms: ${message}`));
}

export async function printSummaryTable(
  summary: DeterministicSummary,
  outputDir: string,
  llmUsed: boolean,
): Promise<void> {
  const ui = getUiRuntime();
  const severityCounts: Record<Severity, number> = { low: 0, med: 0, high: 0 };
  for (const risk of summary.risks) {
    severityCounts[risk.severity] += 1;
  }
  const improveCounts = countIssueSeverity(summary.issues.filter(isImproveIssue));
  const entrypointSplit = splitDisplayEntrypoints(summary.keyFiles.entrypoints);
  const fixtureEntrypoints = summary.keyFiles.entrypoints.filter((entry) => !entrypointSplit.allNonFixture.includes(entry));
  const licenseSummary = summarizeLicenseStatus(summary);

  const rows: Array<[string, string]> = [
    ["Repo type", summary.classification.projectType],
    ["Languages", summary.languageBreakdown.slice(0, 5).map((x) => x.language).join(", ") || "unknown"],
    ["Runtime entrypoints", entrypointSplit.runtime.slice(0, 5).join(", ") || "none"],
    ["Library entrypoints", entrypointSplit.library.slice(0, 5).join(", ") || "none"],
    ["Fixture/test paths", fixtureEntrypoints.slice(0, 3).join(", ") || "none"],
    ["License", licenseSummary],
    ["Risk count", `high=${severityCounts.high}, med=${severityCounts.med}, low=${severityCounts.low}`],
    ["Improve count", `high=${improveCounts.high}, med=${improveCounts.med}, low=${improveCounts.low}`],
    ["Output", outputDir],
    ["LLM", llmUsed ? "enabled" : "disabled"],
  ];

  ui.renderer.section("Summary");
  ui.renderer.kvTable(rows);
  ui.renderer.line();
}

export async function printTerminalInsights(input: {
  summary: DeterministicSummary;
  likelyPurpose: string;
  envHints: string[];
  detectedLicense: string | null;
}): Promise<void> {
  const ui = getUiRuntime();
  if (ui.capabilities.quiet) {
    return;
  }

  const { summary } = input;
  const severityCounts: Record<Severity, number> = { low: 0, med: 0, high: 0 };
  for (const risk of summary.risks) {
    severityCounts[risk.severity] += 1;
  }

  ui.renderer.section("Insights");

  const introLines = [
    ui.theme.colors.heading("What This Repo Does"),
    `- ${input.likelyPurpose}`,
    "",
    ui.theme.colors.heading("How To Run (Best Guess)"),
  ];
  await ui.renderer.revealLines(introLines, { maxMs: 260 });
  const classificationSignal = summary.evidence?.classification?.[0];
  if (classificationSignal) {
    ui.renderer.line(
      `- classification signal: ${shrink(
        `${classificationSignal.path}: ${classificationSignal.snippet}`,
        98,
      )}`,
    );
  }

  const executedCommands = summary.tryRun?.executions || [];
  if (executedCommands.length > 0) {
    const rows = executedCommands.slice(0, 6).map((execution) => {
      const command = `${execution.command}${execution.args.length ? ` ${execution.args.join(" ")}` : ""}`;
      return [
        execution.step,
        command,
        runVerificationLabel(execution),
        execution.timedOut ? "timeout" : String(execution.exitCode ?? "null"),
        `${(execution.durationMs / 1000).toFixed(1)}s`,
        shortNote(execution.verificationEvidence),
      ];
    });
    ui.renderer.asciiTable(["Step", "Command", "Status", "Exit", "Time", "Note"], rows);
    ui.renderer.line("Legend: verified=confirmed signal, partial=indirect signal, failed=execution failed, skipped=not executed");
    ui.renderer.line("Try-Run Evidence:");
    ui.renderer.bulletList(executedCommands.slice(0, 6).map((execution) => `${execution.step}: ${execution.verificationEvidence}`), 2);
  } else {
    ui.renderer.line("- verified: none (try-run not executed)");
  }

  const discovered = deriveDeterministicDiscoveredCommands(summary);
  const executedSet = new Set(executedCommands.map((execution) => normalizeCommand(`${execution.command} ${execution.args.join(" ")}`)));
  const suggested = discovered
    .filter((command) => isAllowedDeterministicCommand(command))
    .filter((command) => !executedSet.has(normalizeCommand(command)));

  if (suggested.length > 0) {
    ui.renderer.line("- suggested (not verified):");
    ui.renderer.bulletList(suggested.slice(0, 4).map((command) => command), 2);
  }

  if (summary.tryRun) {
    ui.renderer.line(`- try-run: ${summary.tryRun.summary}`);
    const startExecs = summary.tryRun.executions.filter((exec) => exec.step === "start");
    const startExec = startExecs.length > 0 ? startExecs[startExecs.length - 1] : undefined;
    if (!startExec) {
      ui.renderer.line("- start verification: not attempted");
    } else if (startExec.timedOut) {
      ui.renderer.line("- start verification: not validated (timeout)");
    } else if (startExec.verificationStatus === "failed") {
      ui.renderer.line("- start verification: not validated (failed)");
    } else if (startExec.helpMode) {
      ui.renderer.line("- start verification: help output only (server startup not validated)");
    } else {
      ui.renderer.line(`- start verification: ${startExec.verificationEvidence}`);
    }
  }
  ui.renderer.line();

  const metrics = summary.metrics;
  ui.renderer.section("Coverage");
  if (!metrics) {
    ui.renderer.line("- Coverage metrics unavailable.");
  } else {
    const tsJsFilesWithEdges = summary.architecture.metrics.tsJsFilesWithEdges ?? estimateTsJsFilesWithEdges(summary);
    const parseSuccessPct = metrics.tsJsFiles > 0 ? Math.round((metrics.tsJsParsed / metrics.tsJsFiles) * 100) : 0;
    const graphYieldPct = metrics.tsJsFiles > 0 ? Math.round((tsJsFilesWithEdges / metrics.tsJsFiles) * 100) : 0;
    ui.renderer.bulletList([
      `Files scanned: ${metrics.filesScanned}`,
      `Text files read: ${metrics.textFilesScanned}`,
      `TS/JS files: ${metrics.tsJsFiles}`,
      `Parse success: ${metrics.tsJsParsed}/${metrics.tsJsFiles} (${parseSuccessPct}%)`,
      `Graph yield: ${tsJsFilesWithEdges}/${metrics.tsJsFiles} (${graphYieldPct}%)`,
      `Skipped (binary/large): ${metrics.skippedBinaryOrLarge}`,
    ]);
  }
  ui.renderer.line();

  ui.renderer.section("Architecture");
  ui.renderer.line(`- Graph: ${summary.architecture.nodes.length} modules, ${summary.architecture.edges.length} edges`);
  if (summary.architecture.topModules.length > 0) {
    ui.renderer.bulletList(
      summary.architecture.topModules.slice(0, 5).map((module) =>
        `hotspot: ${module.path} (degree ${module.degree}) - ${hotspotReason(summary, module.id)}`),
    );
  } else {
    ui.renderer.line("- hotspot: no high-centrality module detected.");
  }
  ui.renderer.line();

  ui.renderer.section("Security / License Risks");
  ui.renderer.bulletList([
    `License: ${input.detectedLicense || "none"}`,
    `Risks: high=${severityCounts.high}, med=${severityCounts.med}, low=${severityCounts.low}`,
  ]);
  if (summary.risks.length > 0) {
    ui.renderer.bulletList(summary.risks.slice(0, 5).map((risk) => `${risk.severity}: ${shrink(risk.title, 92)}`));
  }
  ui.renderer.line();

  ui.renderer.section("Configuration (Env)");
  const required = summary.envAnalysis?.required || [];
  const requiredByFlags = summary.envAnalysis?.requiredByFlags || [];
  const optional = summary.envAnalysis?.optional || [];
  const mentioned = summary.envAnalysis?.mentioned || [];
  const optionalFeature = optional.filter((item) => isFeatureScopedEnv(item.name));
  const optionalGeneral = optional.filter((item) => !isFeatureScopedEnv(item.name));
  const mentionedProviders = mentioned.filter((item) => isFeatureScopedEnv(item.name));
  const mentionedGeneral = mentioned.filter((item) => !isFeatureScopedEnv(item.name));
  if (required.length === 0 && requiredByFlags.length === 0 && optional.length === 0 && mentioned.length === 0 && input.envHints.length === 0) {
    ui.renderer.line("- No explicit env vars detected.");
  } else {
    if (required.length > 0) {
      ui.renderer.bulletList(required.slice(0, 8).map((env) => `required (core run): ${env.name}`));
    }
    if (requiredByFlags.length > 0) {
      ui.renderer.bulletList(requiredByFlags.slice(0, 8).map((env) => {
        const triggers = extractFlagTriggersFromEvidence(env.evidence);
        if (triggers.length > 0) {
          return `required (flags: ${triggers.join(", ")}): ${env.name}`;
        }
        return `required (flags): ${env.name}`;
      }));
    }
    if (optionalGeneral.length > 0) {
      ui.renderer.bulletList(optionalGeneral.slice(0, 6).map((env) => `optional: ${env.name}`));
    }
    if (optionalFeature.length > 0) {
      ui.renderer.bulletList(optionalFeature.slice(0, 6).map((env) => `optional (feature-enabled): ${env.name}`));
    }
    if (mentionedGeneral.length > 0) {
      ui.renderer.bulletList(mentionedGeneral.slice(0, 6).map((env) => `mentioned: ${env.name}`));
    }
    if (mentionedProviders.length > 0) {
      ui.renderer.bulletList(mentionedProviders.slice(0, 6).map((env) => `mentioned (supported providers): ${env.name}`));
    }
    if (required.length === 0 && requiredByFlags.length === 0 && optional.length === 0) {
      ui.renderer.bulletList(input.envHints.slice(0, 10));
    }
    if ((summary.envAnalysis?.filteredOut || []).length > 0) {
      ui.renderer.line(`- filtered generic vars: ${summary.envAnalysis?.filteredOut.length}`);
    }
  }
  ui.renderer.line();

  ui.renderer.section("Where To Improve");
  const improveIssues = summary.issues.filter(isImproveIssue);
  if (summary.formatting) {
    const formattingMessage = summary.formatting.detectedTools.length === 0
      ? summary.formatting.hasFormatScript
        ? "tool unknown (format script exists but no prettier/biome/eslint signal)"
        : "none detected (no prettier/biome/eslint deps, no config files, no format script)"
      : `tools=${summary.formatting.detectedTools.join(", ")}, format-script=${summary.formatting.hasFormatScript ? "yes" : "no"}`;
    ui.renderer.line(`- formatting: ${formattingMessage}`);
  }
  if (improveIssues.length === 0) {
    ui.renderer.line("- No issues generated.");
  } else {
    for (const issue of improveIssues.slice(0, 5)) {
      ui.renderer.line(`- ${issue.severity}: ${shrink(issue.title, 92)} (confidence ${issue.confidence.toFixed(2)})`);
      if (issue.evidence[0]) {
        ui.renderer.line(`  evidence: ${shrink(issue.evidence[0], 88)}`);
      }
      const action = improveActionHint(issue.title);
      if (action) {
        ui.renderer.line(`  action: ${action}`);
      }
    }
  }
  const goodFirst = improveIssues.filter((issue) => {
    const labels = issue.labels.map((label) => label.toLowerCase());
    return (
      (issue.severity === "low" || issue.severity === "med") &&
      issue.confidence >= 0.65 &&
      labels.some((label) => label.includes("documentation") || label.includes("category:quality") || label.includes("architecture"))
    );
  });
  if (goodFirst.length > 0) {
    ui.renderer.line(`- good-first: ${goodFirst.slice(0, 3).map((issue) => issue.title).join(" | ")}`);
  }
  ui.renderer.line();
}

function isImproveIssue(issue: { labels: string[] }): boolean {
  const labels = issue.labels.map((label) => label.toLowerCase());
  const riskTagged = labels.some(
    (label) =>
      label.includes("category:license") ||
      label.includes("category:secret") ||
      label.includes("category:dependency") ||
      label.includes("category:ci"),
  );
  if (riskTagged) {
    return false;
  }
  return labels.some(
    (label) => label.includes("documentation") || label.includes("category:quality") || label.includes("architecture"),
  );
}

function countIssueSeverity(issues: Array<{ severity: Severity }>): Record<Severity, number> {
  const counts: Record<Severity, number> = { low: 0, med: 0, high: 0 };
  for (const issue of issues) {
    counts[issue.severity] += 1;
  }
  return counts;
}

function filterDisplayEntrypoints(paths: string[]): string[] {
  const filtered = paths.filter((path) => {
    const lower = path.toLowerCase();
    return !(
      lower.includes("/test/") ||
      lower.includes("/tests/") ||
      lower.includes("/fixture/") ||
      lower.includes("/fixtures/") ||
      lower.includes("/example/") ||
      lower.includes("/examples/")
    );
  });
  return filtered.length > 0 ? filtered : paths;
}

function splitDisplayEntrypoints(paths: string[]): { runtime: string[]; library: string[]; allNonFixture: string[] } {
  const filtered = filterDisplayEntrypoints(paths);
  const runtime: string[] = [];
  const library: string[] = [];
  for (const entry of filtered) {
    if (isRuntimeEntrypoint(entry)) runtime.push(entry);
    else library.push(entry);
  }
  return {
    runtime: unique(runtime),
    library: unique(library),
    allNonFixture: unique(filtered),
  };
}

function isRuntimeEntrypoint(relPath: string): boolean {
  const lower = relPath.toLowerCase();
  return (
    lower.includes("/cli.") ||
    lower.endsWith("/cli.ts") ||
    lower.endsWith("/cli.js") ||
    lower.includes("/commands/") ||
    lower.includes("/server.") ||
    lower.endsWith("/main.ts") ||
    lower.endsWith("/main.js") ||
    lower.endsWith("/app.ts") ||
    lower.endsWith("/app.js") ||
    lower.includes("/bin/")
  );
}

function normalizeCommand(command: string): string {
  return command.replace(/\s+/g, " ").trim().toLowerCase();
}

function deriveDeterministicDiscoveredCommands(summary: DeterministicSummary): string[] {
  if (summary.tryRun?.planner.proposedCommands?.length) {
    return summary.tryRun.planner.proposedCommands.slice();
  }
  return [...summary.runGuess.installCommands, ...summary.runGuess.testCommands, ...summary.runGuess.runCommands];
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

function runVerificationLabel(execution: CommandExecution): string {
  if (execution.verificationStatus === "partial" && execution.helpMode && execution.step === "start") {
    return "partial";
  }
  return execution.verificationStatus;
}

function shortNote(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 36) return normalized;
  return `${normalized.slice(0, 35)}…`;
}

function improveActionHint(title: string): string | null {
  const lower = title.toLowerCase();
  if (lower.includes(".env.example")) {
    return "create .env.example and add env docs section in README";
  }
  if (lower.includes("formatting") || lower.includes("format script")) {
    return "add Biome or Prettier config and expose bun run format";
  }
  if (lower.includes("high-centrality module") && lower.includes("src/types.ts")) {
    return "split src/types.ts -> src/types/{core,cli,pipeline,risk,output}.ts + barrel export";
  }
  return null;
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items));
}

function extractFlagTriggersFromEvidence(
  evidence: Array<{ source: string; path: string; snippet: string }>,
): string[] {
  const triggers = new Set<string>();
  for (const item of evidence) {
    const combined = `${item.source} ${item.path} ${item.snippet}`;
    const matches = combined.match(/--[a-z0-9-]+/gi) || [];
    for (const match of matches) {
      triggers.add(match.toLowerCase());
    }
    if (/llm mode is enabled|llm-mandatory/i.test(combined)) {
      triggers.add("--llm-mandatory");
    }
  }
  return Array.from(triggers);
}

function isFeatureScopedEnv(name: string): boolean {
  const upper = name.toUpperCase();
  return (
    upper.includes("OLLAMA") ||
    upper.includes("ANTHROPIC") ||
    upper.includes("OPENROUTER") ||
    upper.includes("XAI") ||
    upper.includes("GROK") ||
    upper.includes("GEMINI") ||
    upper.includes("GOOGLE") ||
    upper.includes("AZURE") ||
    upper.includes("MISTRAL") ||
    upper.includes("COHERE")
  );
}

function summarizeLicenseStatus(summary: DeterministicSummary): string {
  const missing = summary.risks.find((risk) => risk.id === "license-missing");
  if (missing) {
    return "missing (medium risk)";
  }
  const unrecognized = summary.risks.find((risk) => risk.id === "license-unrecognized");
  if (unrecognized) {
    return "unrecognized (low risk)";
  }
  if (summary.keyFiles.license) {
    return "present";
  }
  return "unknown";
}

function hotspotReason(summary: DeterministicSummary, moduleId: string): string {
  let fanIn = 0;
  let fanOut = 0;
  for (const edge of summary.architecture.edges) {
    if (edge.to === moduleId) fanIn += 1;
    if (edge.from === moduleId) fanOut += 1;
  }
  if (fanIn > 0 && fanOut > 0) return `fan-in=${fanIn}, fan-out=${fanOut}`;
  if (fanIn > 0) return `fan-in=${fanIn}`;
  if (fanOut > 0) return `fan-out=${fanOut}`;
  return "degree-only centrality";
}

function estimateTsJsFilesWithEdges(summary: DeterministicSummary): number {
  const files = new Set<string>();
  for (const edge of summary.architecture.edges) {
    if (!edge.from.endsWith(".py")) files.add(edge.from);
    if (!edge.to.endsWith(".py")) files.add(edge.to);
  }
  return files.size;
}

function shrink(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
