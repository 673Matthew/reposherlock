import path from "node:path";
import type { AnalyzeOptions, LlmProviderType } from "../types.js";
import { runAnalyzePipeline } from "../pipeline/analyzePipeline.js";
import { timestampForPath } from "../utils/time.js";
import { printRunPlanPanel, printTerminalInsights, resetUiForRun, showSherlockIntro } from "../utils/console.js";
import { SUPPORTED_LLM_PROVIDERS } from "../llm/provider.js";
import { validateRepoTargetOrThrow } from "../ingest/target.js";
import {
  getStoredApiKeyForProvider,
  loadUserLlmCredentials,
  loadUserLlmPreferences,
} from "../utils/userConfig.js";

export interface AnalyzeCliOptions {
  out?: string;
  format?: string;
  depth?: string;
  maxFiles?: string;
  includeTests?: boolean;
  tryRun?: boolean;
  timeout?: string;
  noNetwork?: boolean;
  network?: boolean;
  redactSecrets?: boolean;
  verbose?: boolean;
  llm?: boolean;
  provider?: LlmProviderType;
  llmProvider?: LlmProviderType;
  model?: string;
  llmModel?: string;
  apiKey?: string;
  llmApiKey?: string;
  llmBaseUrl?: string;
  llmMaxChars?: string;
  llmPerFileChars?: string;
  tryRunPython?: boolean;
  tryRunPolicy?: string;
  prDraft?: boolean;
  noAnimation?: boolean;
  inlineReport?: boolean;
  thinking?: boolean;
  skipRunPlan?: boolean;
}

export async function analyzeCommand(target: string, cli: AnalyzeCliOptions): Promise<void> {
  validateRepoTargetOrThrow(target, process.cwd());
  const effective = await applyLlmDefaults(cli);
  const options = normalizeAnalyzeOptions(effective);
  await showSherlockIntro("0.1.0");
  if (!effective.skipRunPlan) {
    printRunPlanPanel({
      target,
      llmEnabled: true,
      llmMandatory: true,
      provider: options.llmProvider,
      model: options.llmModel || process.env.LLM_MODEL || "auto",
      tryRun: options.tryRun,
      prDraft: Boolean(options.prDraft),
    });
  }
  resetUiForRun();
  const result = await runAnalyzePipeline({
    target,
    options,
    workspaceRoot: process.cwd(),
  });

  if (cli.inlineReport ?? true) {
    await printTerminalInsights({
      summary: result.summary,
      likelyPurpose: result.likelyPurpose,
      envHints: result.envHints,
      detectedLicense: result.detectedLicense,
    });
  }
}

async function applyLlmDefaults(cli: AnalyzeCliOptions): Promise<AnalyzeCliOptions> {
  const prefs = await loadUserLlmPreferences();
  const provider = parseProvider(cli.provider || cli.llmProvider || prefs.defaultProvider);
  const creds = await loadUserLlmCredentials();
  const storedApiKey = getStoredApiKeyForProvider(creds, provider);

  return {
    ...cli,
    provider,
    llmProvider: provider,
    model: cli.model || cli.llmModel || prefs.modelByProvider[provider],
    llmModel: cli.model || cli.llmModel || prefs.modelByProvider[provider],
    llmApiKey: cli.apiKey || cli.llmApiKey || storedApiKey,
  };
}

function normalizeAnalyzeOptions(cli: AnalyzeCliOptions): AnalyzeOptions {
  const outDir = cli.out || path.join(".reposherlock", "output", timestampForPath());
  const format = parseFormat(cli.format || "md,json");

  return {
    outDir,
    format,
    depth: clampNum(cli.depth, 6, 1, 20),
    maxFiles: clampNum(cli.maxFiles, 2500, 1, 25000),
    includeTests: cli.includeTests ?? true,
    tryRun: cli.tryRun ?? false,
    timeoutSeconds: clampNum(cli.timeout, 120, 5, 3600),
    noNetwork: cli.noNetwork ?? cli.network === false,
    redactSecrets: cli.redactSecrets ?? true,
    verbose: cli.verbose ?? false,
    llm: true,
    llmProvider: parseProvider(cli.provider || cli.llmProvider),
    llmModel: cli.model || cli.llmModel,
    llmApiKey: cli.apiKey || cli.llmApiKey,
    llmMaxChars: clampNum(cli.llmMaxChars, 80_000, 10_000, 300_000),
    llmPerFileChars: clampNum(cli.llmPerFileChars, 12_000, 1000, 50_000),
    tryRunPython: cli.tryRunPython ?? false,
    tryRunPolicyPath: cli.tryRunPolicy,
    prDraft: cli.prDraft ?? false,
    animation: !(cli.noAnimation ?? false),
  };
}

function parseProvider(value?: string): LlmProviderType {
  if (!value) return "openai";
  const normalized = value.trim().toLowerCase() as LlmProviderType;
  return SUPPORTED_LLM_PROVIDERS.includes(normalized) ? normalized : "openai";
}

function clampNum(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function parseFormat(value: string): Array<"md" | "json"> {
  const parts = value
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

  const set = new Set<"md" | "json">();
  for (const part of parts) {
    if (part === "md" || part === "json") {
      set.add(part);
    }
  }

  if (set.size === 0) {
    return ["md", "json"];
  }

  return Array.from(set);
}
