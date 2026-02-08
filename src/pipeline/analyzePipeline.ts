import path from "node:path";
import { resolveRepo } from "../ingest/repoResolver.js";
import { createLlmProvider, providerRequiresApiKey, resolveLlmConfig } from "../llm/provider.js";
import { runLlmPolishPass } from "../llm/polish.js";
import { buildSafePromptPack } from "../llm/safePacker.js";
import { writeAllArtifacts } from "../output/writer.js";
import { buildArchitectureMap } from "../parsers/moduleMap.js";
import { generateActionableIssues } from "./issues.js";
import { runRiskAnalysis } from "../risk/index.js";
import { buildFileIndex } from "../scanner/fileIndexer.js";
import { detectKeyFiles } from "../scanner/keyFiles.js";
import { buildLanguageBreakdown } from "../scanner/language.js";
import { buildRunPlan } from "../run/planner.js";
import { loadTryRunPolicy } from "../run/policy.js";
import { executeRunPlan } from "../run/executor.js";
import type {
  AnalyzeOptions,
  ArchitectureMap,
  DeterministicSummary,
  EnvAnalysis,
  EvidenceRef,
  FileIndexEntry,
  KeyFiles,
  LanguageBreakdown,
  LlmEnhancementOutput,
  RepoIdentity,
  RunAttemptResult,
} from "../types.js";
import { getStageRunner, printSummaryTable, setConsoleAnimation } from "../utils/console.js";
import { ensureDir } from "../utils/fs.js";
import { JsonlLogger } from "../utils/logger.js";
import { nowIso } from "../utils/time.js";
import { runUnderstandStage } from "./understand.js";
import type { UnderstandResult } from "./understand.js";
import { createConfigSnapshot, renderReadme20Markdown, renderReportMarkdown } from "../output/renderers.js";
import type { RiskScanResult } from "../risk/index.js";
import { getUiRuntime } from "../ui/runtime.js";
import { ThinkingPanel } from "../ui/thinkingPanel.js";

export interface AnalyzePipelineInput {
  target: string;
  options: AnalyzeOptions;
  workspaceRoot: string;
}

export interface AnalyzePipelineResult {
  outputDir: string;
  summary: DeterministicSummary;
  likelyPurpose: string;
  envHints: string[];
  detectedLicense: string | null;
}

export async function runAnalyzePipeline(input: AnalyzePipelineInput): Promise<AnalyzePipelineResult> {
  setConsoleAnimation(input.options.animation);
  const outputDir = path.resolve(input.workspaceRoot, input.options.outDir);
  await ensureDir(outputDir);

  const logger = new JsonlLogger(path.join(outputDir, "logs.jsonl"));
  await logger.init();

  const configSnapshot = createConfigSnapshot(input.options);
  await logger.log({
    ts: nowIso(),
    stage: "meta",
    event: "start",
    inputSummary: {
      target: input.target,
      outputDir,
      config: configSnapshot.analyzeOptions,
    },
  });
  const ui = getUiRuntime();
  const thinkingPanel = new ThinkingPanel(ui.renderer, ui.scheduler, ui.capabilities, ui.theme);
  const thinkingSteps = [
    "Validating repository target and runtime profile",
    "Planning scan strategy and safe execution path",
    "Preparing architecture, risk, and issue synthesis",
  ];
  thinkingPanel.start(thinkingSteps);
  const plannedStages = buildPlannedStages(input.options);
  thinkingPanel.setPlannedStages(plannedStages);
  const stageRunner = getStageRunner();
  const unsubscribeStageEvents = stageRunner.onEvent((event) => {
    thinkingPanel.onStageEvent(event);
  });
  stageRunner.setOutputSuspended(true);

  let thinkingStopped = false;
  let activeThinkingIndex = -1;
  const activateThinking = (index: number, note?: string): void => {
    activeThinkingIndex = index;
    thinkingPanel.activate(index);
    if (note) {
      thinkingPanel.note(note);
    }
  };
  const completeThinking = async (index: number): Promise<void> => {
    await thinkingPanel.complete(index);
    activeThinkingIndex = -1;
  };
  const finalizeThinking = async (): Promise<void> => {
    if (thinkingStopped) return;
    thinkingStopped = true;
    await thinkingPanel.stop({ finalize: true });
    stageRunner.setOutputSuspended(false);
    stageRunner.clearBufferedOutput();
    unsubscribeStageEvents();
  };

  try {
    let repoIdentity!: RepoIdentity;
    activateThinking(0, "resolving source repository");
    await stageRunner.withStage("A) Ingest", async () => {
    const ingestLog = await logger.stageStart("A-Ingest", { target: input.target, noNetwork: input.options.noNetwork });
    try {
      repoIdentity = await resolveRepo({
        input: input.target,
        workspaceRoot: input.workspaceRoot,
        noNetwork: input.options.noNetwork,
      });
      await logger.stageEnd("A-Ingest", ingestLog, { resolvedPathLength: repoIdentity.resolvedPath.length });
    } catch (error) {
      await logger.stageError("A-Ingest", ingestLog, error);
      throw error;
    }
  }, {
    hints: [
      "validating GitHub URL",
      "resolving source path",
      "capturing repository identity",
    ],
    });
    await completeThinking(0);

    let fileIndex: FileIndexEntry[] = [];
    let keyFiles!: KeyFiles;
    let languageBreakdown!: LanguageBreakdown[];
    let understanding!: UnderstandResult;
    let architecture!: ArchitectureMap;
    activateThinking(1, "indexing files and building module graph");
    await stageRunner.withStage("B) Scan + Understand", async () => {
    const scanLog = await logger.stageStart("B-Scan", {
      depth: input.options.depth,
      maxFiles: input.options.maxFiles,
    });
    try {
      fileIndex = await buildFileIndex({
        rootDir: repoIdentity.resolvedPath,
        maxDepth: input.options.depth,
        maxFiles: input.options.maxFiles,
        includeTests: input.options.includeTests,
      });
      stageRunner.emitMetric("B) Scan + Understand", { filesIndexed: fileIndex.length });
      keyFiles = detectKeyFiles(fileIndex);
      languageBreakdown = buildLanguageBreakdown(fileIndex);
      understanding = await runUnderstandStage(repoIdentity.resolvedPath, fileIndex, keyFiles, languageBreakdown);
      architecture = await buildArchitectureMap(repoIdentity.resolvedPath, fileIndex);

      await logger.stageEnd("B-Scan", scanLog, {
        files: fileIndex.length,
        nodes: architecture.nodes.length,
        edges: architecture.edges.length,
      });
    } catch (error) {
      await logger.stageError("B-Scan", scanLog, error);
      throw error;
    }
    }, {
    hints: [
      "indexing repository files",
      "detecting key entrypoints",
      "parsing module imports",
      "building architecture map",
    ],
    });
    await completeThinking(1);

    let riskResult!: RiskScanResult;
    activateThinking(2, "evaluating risk and quality signals");
    await stageRunner.withStage("C) Risk Analysis", async () => {
    const riskLog = await logger.stageStart("C-Risk", { redactSecrets: input.options.redactSecrets });
    try {
      riskResult = await runRiskAnalysis(repoIdentity.resolvedPath, keyFiles, fileIndex, input.options.redactSecrets);
      await logger.stageEnd("C-Risk", riskLog, {
        risks: riskResult.risks.length,
        secretFindings: riskResult.secretFindings,
      });
    } catch (error) {
      await logger.stageError("C-Risk", riskLog, error);
      throw error;
    }
    }, {
    hints: [
      "checking license signals",
      "scanning for secret patterns",
      "evaluating dependency and CI risks",
    ],
    });

    let envAnalysis!: EnvAnalysis;
    let envHints!: string[];
    let issues!: ReturnType<typeof generateActionableIssues>;
    thinkingPanel.note("synthesizing actionable issues");
    await stageRunner.withStage("D) Actionable Issues", async () => {
    const issueLog = await logger.stageStart("D-Issues", {});
    try {
      envAnalysis = enrichEnvAnalysisForFlags(understanding.envAnalysis, input.options);
      envHints = [
        ...envAnalysis.required.map((item) => item.name),
        ...envAnalysis.requiredByFlags.map((item) => item.name),
        ...envAnalysis.optional.map((item) => item.name),
        ...envAnalysis.mentioned.map((item) => item.name),
      ];

      issues = generateActionableIssues({
        risks: riskResult.risks,
        architecture,
        keyFiles,
        envAnalysis,
        qualitySignals: riskResult.qualitySignals,
      });
      await logger.stageEnd("D-Issues", issueLog, { issues: issues.length });
    } catch (error) {
      await logger.stageError("D-Issues", issueLog, error);
      throw error;
    }
    }, {
    hints: [
      "ranking findings by severity",
      "attaching reproducible evidence",
      "drafting good-first issues",
    ],
    });

    let runAttempt: RunAttemptResult | undefined;
    if (input.options.tryRun) {
      thinkingPanel.note("running sandbox pass with safe command planner");
      await stageRunner.withStage("E) Try-Run Sandbox Pass", async () => {
      const runLog = await logger.stageStart("E-TryRun", { timeoutSeconds: input.options.timeoutSeconds });
      try {
        const plan = await buildRunPlan({
          rootDir: repoIdentity.resolvedPath,
          keyFiles,
          timeoutSeconds: input.options.timeoutSeconds,
          tryRunPython: input.options.tryRunPython,
          policy: await loadTryRunPolicy(repoIdentity.resolvedPath, input.options.tryRunPolicyPath),
        });
        runAttempt = await executeRunPlan({
          sourceRepoPath: repoIdentity.resolvedPath,
          plan,
          timeoutSeconds: input.options.timeoutSeconds,
          maxOutputChars: 200_000,
          onCommandEvent: (event) => {
            const elapsedLabel = event.elapsedSeconds ? ` (${event.elapsedSeconds}s)` : "";
            if (event.type === "start" || event.type === "progress") {
              thinkingPanel.note(`[try-run ${event.index}/${event.total}] ${event.commandText}${elapsedLabel}`);
              return;
            }
            if (event.type === "fallback") {
              thinkingPanel.note(`[try-run] timeout detected, attempting fallback start command`);
              return;
            }
            if (event.type === "end") {
              const timedOut = event.timedOut ? " timeout" : "";
              const verification = event.verificationStatus ? ` ${event.verificationStatus}` : "";
              thinkingPanel.note(`[try-run ${event.index}/${event.total}] finished${timedOut}${verification}`);
            }
          },
        });
        stageRunner.emitMetric("E) Try-Run Sandbox Pass", {
          planned: plan.executableCommands.length,
          executed: runAttempt.executions.length,
        });
        await logger.stageEnd("E-TryRun", runLog, {
          planned: plan.executableCommands.length,
          executed: runAttempt.executions.length,
        });
      } catch (error) {
        await logger.stageError("E-TryRun", runLog, error);
        throw error;
      }
      }, {
      hints: [
        "planning safe executable commands",
        "running in temporary sandbox",
        "classifying execution outcomes",
      ],
      });
    }

  const textFilesScanned = fileIndex.filter((item) => !item.isBinary).length;
  const tsJsFiles = fileIndex.filter((item) =>
    [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(item.ext),
  ).length;
  const skippedBinaryOrLarge = fileIndex.filter((item) => item.isBinary || item.sizeBytes > 1_000_000).length;
  const warningsCount = riskResult.risks.length + riskResult.qualitySignals.length;

  const summary: DeterministicSummary = {
    repoIdentity,
    generatedAt: nowIso(),
    languageBreakdown,
    metrics: {
      filesScanned: fileIndex.length,
      textFilesScanned,
      tsJsFiles,
      tsJsParsed: architecture.metrics.tsJsParsedFiles,
      parsedModules: architecture.metrics.parsedFiles,
      moduleMapCoverage: architecture.metrics.tsJsCoverage,
      skippedBinaryOrLarge,
      warningsCount,
    },
    keyFiles,
    classification: understanding.classification,
    runGuess: understanding.runGuess,
    envAnalysis,
    formatting: riskResult.formatting,
    qualitySignals: riskResult.qualitySignals,
    evidence: {
      ...understanding.evidence,
      architecture: buildArchitectureEvidence(architecture),
    },
    architecture,
    risks: riskResult.risks,
    issues,
    tryRun: runAttempt,
  };

  const deterministicReadme = renderReadme20Markdown({
    summary,
    likelyPurpose: understanding.likelyPurpose,
    envHints,
    envAnalysis,
    config: configSnapshot,
    llmUsed: false,
  });

  const deterministicReport = renderReportMarkdown({
    summary,
    likelyPurpose: understanding.likelyPurpose,
    envHints,
    envAnalysis,
    detectedLicense: riskResult.detectedLicense,
    formatting: riskResult.formatting,
    config: configSnapshot,
    llmUsed: false,
    prDraftEnabled: Boolean(input.options.prDraft),
  });

  let llmResult: LlmEnhancementOutput | undefined;
  let likelyPurpose = understanding.likelyPurpose;
  if (input.options.llm) {
    thinkingPanel.note("running LLM polish pass");
    await stageRunner.withStage("F) LLM Polish Pass", async () => {
      const llmLog = await logger.stageStart("F-LLM", {
        provider: input.options.llmProvider,
        model: input.options.llmModel,
      });

      try {
        const llmConfig = resolveLlmConfig({
          provider: input.options.llmProvider,
          model: input.options.llmModel,
          baseUrl: input.options.llmBaseUrl,
          apiKey: input.options.llmApiKey,
          maxChars: input.options.llmMaxChars,
          perFileChars: input.options.llmPerFileChars,
        });

        if (providerRequiresApiKey(llmConfig.provider) && !llmConfig.apiKey) {
          throw new Error(
            `API key is missing for provider '${llmConfig.provider}'. Configure provider credentials before analyze.`,
          );
        }

        const promptPack = await buildSafePromptPack({
          rootDir: repoIdentity.resolvedPath,
          fileIndex,
          keyFiles,
          summary,
          risks: riskResult.risks,
          config: llmConfig,
        });

        const provider = createLlmProvider(llmConfig);
        const llmStepLabels: Record<"readme" | "issues" | "report", string> = {
          readme: "README polish",
          issues: "Issues polish",
          report: "Report polish",
        };
        llmResult = await runLlmPolishPass({
          provider,
          promptPack,
          deterministicReadme,
          deterministicIssues: issues,
          deterministicReport,
          summary,
          substepHooks: {
            onStart: (_key, label) => {
              thinkingPanel.note(`LLM: ${label}`);
            },
            onComplete: (key) => {
              thinkingPanel.note(`LLM: ${llmStepLabels[key]} complete`);
            },
            onError: (key) => {
              thinkingPanel.note(`LLM: ${llmStepLabels[key]} failed`);
            },
          },
        });
        if (llmResult.purposeSummary) {
          likelyPurpose = llmResult.purposeSummary;
        }

        await logger.stageEnd("F-LLM", llmLog, {
          excerpts: promptPack.excerpts.length,
          promptChars: promptPack.totalChars,
        });
      } catch (error) {
        await logger.stageError("F-LLM", llmLog, error);
        throw error;
      }
    }, {
      hints: [
        "building safe prompt pack",
        "polishing README, report, and issues",
        "preserving deterministic facts",
      ],
    });
  }

  thinkingPanel.note("writing reports, issues, and architecture artifacts");
  await stageRunner.withStage("Output Write", async () => {
    const writeLog = await logger.stageStart("G-Output", { outputDir });
    try {
      await writeAllArtifacts({
        outputDir,
        summary,
        fileIndex,
        risks: riskResult.risks,
        issues,
        likelyPurpose,
        deterministicLikelyPurpose: understanding.likelyPurpose,
        envHints,
        envAnalysis,
        detectedLicense: riskResult.detectedLicense,
        config: configSnapshot,
        llmUsed: input.options.llm,
        llmResult,
        runAttempt,
        generatePrDraft: input.options.prDraft,
        formatting: riskResult.formatting,
      });

      await logger.stageEnd("G-Output", writeLog, {
        filesScanned: fileIndex.length,
        risks: riskResult.risks.length,
        issues: issues.length,
      });
    } catch (error) {
      await logger.stageError("G-Output", writeLog, error);
      throw error;
    }
  }, {
    hints: [
      "rendering markdown and json artifacts",
      "writing issue templates and sarif",
      "finalizing logs and index outputs",
    ],
  });

  await completeThinking(2);
  await finalizeThinking();

  await printSummaryTable(summary, outputDir, input.options.llm);

  await logger.log({
    ts: nowIso(),
    stage: "meta",
    event: "end",
    inputSummary: {
      repo: summary.repoIdentity,
      generatedAt: summary.generatedAt,
      outputDir,
    },
  });

  return {
    outputDir,
    summary,
    likelyPurpose,
    envHints,
    detectedLicense: riskResult.detectedLicense,
  };
  } catch (error) {
    if (activeThinkingIndex >= 0) {
      thinkingPanel.fail(activeThinkingIndex);
    }
    thinkingPanel.note("analysis interrupted");
    await finalizeThinking();
    throw error;
  } finally {
    if (!thinkingStopped) {
      await finalizeThinking();
    }
  }
}

function buildPlannedStages(options: AnalyzeOptions): string[] {
  const stages = [
    "A) Ingest",
    "B) Scan + Understand",
    "C) Risk Analysis",
    "D) Actionable Issues",
  ];
  if (options.tryRun) {
    stages.push("E) Try-Run Sandbox Pass");
  }
  if (options.llm) {
    stages.push("F) LLM Polish Pass");
  }
  stages.push("Output Write");
  return stages;
}

function buildArchitectureEvidence(architecture: ArchitectureMap): EvidenceRef[] {
  const evidence: EvidenceRef[] = [
    {
      source: "module map parser",
      path: "architecture.json",
      snippet: `parsed ${architecture.metrics.parsedFiles}/${architecture.metrics.sourceFiles} source files`,
    },
    {
      source: "module graph stats",
      path: "architecture.json",
      snippet: `nodes=${architecture.nodes.length}, edges=${architecture.edges.length}, ts/js coverage=${Math.round(
        architecture.metrics.tsJsCoverage * 100,
      )}%`,
    },
  ];

  for (const module of architecture.topModules.slice(0, 3)) {
    evidence.push({
      source: "top centrality module",
      path: module.path,
      snippet: `degree=${module.degree}`,
    });
  }

  return evidence;
}

function enrichEnvAnalysisForFlags(base: EnvAnalysis, options: AnalyzeOptions): EnvAnalysis {
  const required = cloneHints(base.required);
  const requiredByFlags = cloneHints(base.requiredByFlags || []);
  const optional = cloneHints(base.optional);
  const mentioned = cloneHints(base.mentioned);

  moveToOptionalByName(required, optional, "REPOSHERLOCK_NO_ANIM", "feature flag for terminal animation behavior");
  moveToOptionalByName(requiredByFlags, optional, "REPOSHERLOCK_NO_ANIM", "feature flag for terminal animation behavior");

  if (options.llm && providerRequiresApiKey(options.llmProvider)) {
    ensureFlagRequiredHint({ required, requiredByFlags, optional, mentioned }, "LLM_API_KEY", {
      source: "flag requirement",
      path: "cli options",
      snippet: "Triggered by --llm-mandatory: LLM mode enabled with an API-key-backed provider.",
    });
  }

  return normalizeEnvBuckets({
    required,
    requiredByFlags,
    optional,
    mentioned,
    filteredOut: base.filteredOut,
  });
}

function cloneHints<T extends { name: string; confidence: number; evidence: EvidenceRef[] }>(items: T[]): T[] {
  return items.map((item) => ({
    ...item,
    evidence: item.evidence.map((ev) => ({ ...ev })),
  })) as T[];
}

function moveToOptionalByName(
  from: Array<{ name: string; confidence: number; evidence: EvidenceRef[] }>,
  optional: Array<{ name: string; confidence: number; evidence: EvidenceRef[] }>,
  name: string,
  snippet: string,
): void {
  const index = from.findIndex((item) => item.name === name);
  if (index === -1) return;
  const [item] = from.splice(index, 1);
  const existing = optional.find((entry) => entry.name === name);
  const evidence = dedupeEvidenceRefs([
    ...item.evidence,
    { source: "env categorizer", path: "analysis flags", snippet },
  ]);
  if (existing) {
    existing.evidence = dedupeEvidenceRefs([...existing.evidence, ...evidence]);
    existing.confidence = Math.max(existing.confidence, item.confidence);
  } else {
    optional.push({
      ...item,
      evidence,
      confidence: Math.max(0.6, item.confidence),
    });
  }
}

function ensureFlagRequiredHint(
  buckets: {
    required: Array<{ name: string; confidence: number; evidence: EvidenceRef[] }>;
    requiredByFlags: Array<{ name: string; confidence: number; evidence: EvidenceRef[] }>;
    optional: Array<{ name: string; confidence: number; evidence: EvidenceRef[] }>;
    mentioned: Array<{ name: string; confidence: number; evidence: EvidenceRef[] }>;
  },
  name: string,
  evidence: EvidenceRef,
): void {
  const existingRequired = buckets.requiredByFlags.find((item) => item.name === name);
  if (existingRequired) {
    existingRequired.evidence = dedupeEvidenceRefs([...existingRequired.evidence, evidence]);
    existingRequired.confidence = Math.max(existingRequired.confidence, 0.9);
    return;
  }
  const baseEvidence = [
    ...pluckHintEvidence(buckets.required, name),
    ...pluckHintEvidence(buckets.optional, name),
    ...pluckHintEvidence(buckets.mentioned, name),
  ];
  buckets.requiredByFlags.push({
    name,
    confidence: 0.9,
    evidence: dedupeEvidenceRefs([...baseEvidence, evidence]),
  });
}

function pluckHintEvidence(
  list: Array<{ name: string; confidence: number; evidence: EvidenceRef[] }>,
  name: string,
): EvidenceRef[] {
  const index = list.findIndex((item) => item.name === name);
  if (index < 0) return [];
  const [item] = list.splice(index, 1);
  return item.evidence;
}

function normalizeEnvBuckets(env: EnvAnalysis): EnvAnalysis {
  const requiredByFlags = uniqueHintList(env.requiredByFlags);
  const required = uniqueHintList(env.required);
  const optional = uniqueHintList(env.optional);
  const mentioned = uniqueHintList(env.mentioned);

  const taken = new Set<string>();
  const dedupeByPriority = (items: Array<{ name: string; confidence: number; evidence: EvidenceRef[] }>) => {
    const next: Array<{ name: string; confidence: number; evidence: EvidenceRef[] }> = [];
    for (const item of items) {
      if (taken.has(item.name)) continue;
      taken.add(item.name);
      next.push(item);
    }
    return next;
  };

  return {
    requiredByFlags: dedupeByPriority(requiredByFlags),
    required: dedupeByPriority(required),
    optional: dedupeByPriority(optional),
    mentioned: dedupeByPriority(mentioned),
    filteredOut: Array.from(new Set(env.filteredOut)).sort(),
  };
}

function uniqueHintList(
  items: Array<{ name: string; confidence: number; evidence: EvidenceRef[] }>,
): Array<{ name: string; confidence: number; evidence: EvidenceRef[] }> {
  const map = new Map<string, { name: string; confidence: number; evidence: EvidenceRef[] }>();
  for (const item of items) {
    const existing = map.get(item.name);
    if (!existing) {
      map.set(item.name, {
        name: item.name,
        confidence: item.confidence,
        evidence: dedupeEvidenceRefs(item.evidence),
      });
      continue;
    }
    existing.confidence = Math.max(existing.confidence, item.confidence);
    existing.evidence = dedupeEvidenceRefs([...existing.evidence, ...item.evidence]);
    map.set(item.name, existing);
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function dedupeEvidenceRefs(items: EvidenceRef[]): EvidenceRef[] {
  const map = new Map<string, EvidenceRef>();
  for (const item of items) {
    const key = `${item.source}|${item.path}|${item.snippet}`;
    if (!map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
}
