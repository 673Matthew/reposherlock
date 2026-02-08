import { createInterface } from "node:readline/promises";
import * as readline from "node:readline";
import { stdin, stdout } from "node:process";
import { spawnSync } from "node:child_process";
import { createLogUpdate } from "log-update";
import type { LlmProviderType } from "../types.js";
import { analyzeCommand } from "./analyze.js";
import {
  getProviderModelOptions,
  getProviderPreset,
  getRecommendedModel,
  providerRequiresApiKey,
  PROVIDER_OFFICIAL_SOURCES,
  resolveProviderApiKey,
} from "../llm/provider.js";
import { isSupportedRepoTarget, validateRepoTargetOrThrow } from "../ingest/target.js";
import { printRunPlanPanel, setConsoleAnimation, showSherlockIntro } from "../utils/console.js";
import {
  getStoredApiKeyForProvider,
  loadUserLlmCredentials,
  loadUserLlmPreferences,
  upsertProviderApiKey,
  upsertProviderModelPreference,
} from "../utils/userConfig.js";

export interface InteractiveCliOptions {
  noAnimation?: boolean;
  thinking?: boolean;
  target?: string;
}

interface Choice<T extends string> {
  value: T;
  label: string;
  description: string;
}

interface ArrowChoice<T> {
  value: T;
  label: string;
  description?: string;
  detail?: string;
}

interface RunProfile {
  tryRun: boolean;
  prDraft: boolean;
}

interface LlmSetup {
  provider: LlmProviderType;
  model: string;
  apiKey?: string;
}

interface BooleanPrompt {
  title: string;
  yesLabel: string;
  yesDescription: string;
  noLabel: string;
  noDescription: string;
  defaultValue: boolean;
}

type ScanProfile = "quick" | "deep" | "full" | "custom";

const PROFILE_CHOICES: Choice<ScanProfile>[] = [
  {
    value: "deep",
    label: "Deep (Recommended)",
    description: "LLM on + try-run on. Strong signal quality for most repos.",
  },
  {
    value: "quick",
    label: "Quick",
    description: "LLM on + try-run off. Faster when you only need architecture/risk/readme.",
  },
  {
    value: "full",
    label: "Full Sherlock",
    description: "LLM on + try-run on + PR draft output.",
  },
  {
    value: "custom",
    label: "Custom",
    description: "Choose try-run and PR draft manually (LLM always on).",
  },
];

const PROVIDER_CHOICES: Choice<LlmProviderType>[] = [
  { value: "openai", label: "OpenAI", description: "Best overall reasoning quality for repo understanding." },
  { value: "gemini", label: "Gemini", description: "Strong long-context analysis, good speed/cost tradeoff." },
  { value: "anthropic", label: "Anthropic", description: "High-quality technical writing and careful summaries." },
  { value: "grok", label: "Grok", description: "Fast responses, solid general reasoning for code reports." },
  { value: "ollama", label: "Ollama (Local)", description: "Local models on your machine (no cloud dependency)." },
  { value: "openai-compatible", label: "OpenAI-Compatible", description: "Gateway/proxy providers with OpenAI API shape." },
];

export async function interactiveCommand(cli: InteractiveCliOptions): Promise<void> {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error("Interactive mode requires a TTY. Use `reposherlock analyze <repo_url_or_path>` in scripts/CI.");
  }

  setConsoleAnimation(!(cli.noAnimation ?? false));
  await showSherlockIntro("0.1.0");
  printPanel("RepoSherlock Wizard", [
    "LLM is mandatory in this workflow.",
    "You choose only Provider + Model + API Key, then analysis starts.",
  ]);
  printPanel("Wizard Tips", [
    "Use arrow keys (or j/k) + Enter for every option list.",
    "If API quota/key fails, wizard opens recovery mode automatically.",
  ]);

  const prefs = await loadUserLlmPreferences();
  const creds = await loadUserLlmCredentials();

  const rl = createInterface({
    input: stdin,
    output: stdout,
    terminal: false,
    historySize: 0,
    removeHistoryDuplicates: true,
  });
  try {
    const target = await resolveWizardTarget(rl, cli.target);

    printSection("Step 2 · Scan Profile");
    const profileKind = await askChoice(
      rl,
      PROFILE_CHOICES,
      0,
      "Scan profile",
    );
    const profile = await resolveProfile(rl, profileKind);

    let timeout = "120";
    if (profile.tryRun) {
      timeout = normalizeTimeout(
        await rl.question(`${accent("Step 3")} Per-command timeout in seconds ${dim("(120)")}: `),
        120,
      );
    }

    let llmSetup = await collectLlmSetup(rl, prefs, creds);

    while (true) {
      printRunPlanPanel({
        target,
        llmEnabled: true,
        llmMandatory: true,
        provider: llmSetup.provider,
        model: llmSetup.model,
        tryRun: profile.tryRun,
        prDraft: profile.prDraft,
      });
      try {
        await analyzeCommand(target, {
          tryRun: profile.tryRun,
          prDraft: profile.prDraft,
          provider: llmSetup.provider,
          model: llmSetup.model,
          apiKey: llmSetup.apiKey,
          timeout,
          noAnimation: cli.noAnimation,
          thinking: cli.thinking,
          skipRunPlan: true,
        });
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isRecoverableLlmFailure(message)) {
          throw error;
        }

        printPanel("LLM Recovery", [
          shrink(message, 120),
          "Provider/model/key can be changed and retried in the same session.",
        ]);
        const recoveryTips = buildRecoverySuggestions(message, llmSetup.provider);
        if (recoveryTips.length > 0) {
          printPanel("Suggested Next Step", recoveryTips);
        }

        const retry = await askBooleanWithArrows(rl, {
          title: "Retry LLM setup?",
          yesLabel: "Retry with new provider/model/key",
          yesDescription: "Stay in wizard and reconfigure LLM settings.",
          noLabel: "Stop run",
          noDescription: "Exit wizard with current error.",
          defaultValue: true,
        });
        if (!retry) {
          throw error;
        }

        const refreshedCreds = await loadUserLlmCredentials();
        llmSetup = await collectLlmSetup(rl, prefs, refreshedCreds, llmSetup.provider);
      }
    }
  } finally {
    rl.close();
  }
}

async function resolveWizardTarget(
  rl: ReturnType<typeof createInterface>,
  prefilled?: string,
): Promise<string> {
  if (prefilled && prefilled.trim()) {
    const normalized = prefilled.trim();
    validateRepoTargetOrThrow(normalized, process.cwd());
    stdout.write(`${accent("Step 1")} Repository URL or local path: ${normalized} ${dim("(from CLI argument)")}\n`);
    return normalized;
  }

  return promptRequired(
    rl,
    `${accent("Step 1")} Repository URL or local path: `,
    (value) => isSupportedRepoTarget(value, process.cwd()),
    "Use a GitHub repo URL (https://github.com/owner/repo) or an existing local directory path.",
  );
}

async function collectLlmSetup(
  rl: ReturnType<typeof createInterface>,
  prefs: Awaited<ReturnType<typeof loadUserLlmPreferences>>,
  creds: Awaited<ReturnType<typeof loadUserLlmCredentials>>,
  preferredProvider?: LlmProviderType,
): Promise<LlmSetup> {
  printSection("Step 4 · LLM Provider");
  const seedProvider = preferredProvider || prefs.defaultProvider;
  const defaultProviderIndex = Math.max(
    0,
    PROVIDER_CHOICES.findIndex((choice) => choice.value === seedProvider),
  );
  const provider = await askChoice(rl, PROVIDER_CHOICES, defaultProviderIndex);
  const source = PROVIDER_OFFICIAL_SOURCES[provider];
  stdout.write(`${dim(`Official models: ${source}`)}\n`);

  printSection("Step 5 · Model");
  const model = await askModelChoice(rl, provider, prefs.modelByProvider[provider]);

  let apiKey = resolveProviderApiKey(provider) || getStoredApiKeyForProvider(creds, provider);
  let enteredNewKey = false;

  if (providerRequiresApiKey(provider)) {
    if (apiKey) {
      stdout.write(`${ok(`API key ready for ${provider}.`)}\n`);
    } else {
      stdout.write(`${warn(`No API key found for ${provider}.`)}\n`);
      apiKey = await promptSecretRequired(rl, `${accent("Step 6")} API key (hidden): `);
      enteredNewKey = true;
    }
  }

  await upsertProviderModelPreference(provider, model);
  if (enteredNewKey && apiKey) {
    const remember = await askBooleanWithArrows(rl, {
      title: "Store API key?",
      yesLabel: "Remember on this machine",
      yesDescription: "Save key in ~/.reposherlock/credentials.json (chmod 600).",
      noLabel: "Use once",
      noDescription: "Keep key only for this run.",
      defaultValue: true,
    });
    if (remember) {
      await upsertProviderApiKey(provider, apiKey);
      stdout.write(`${ok("API key stored in ~/.reposherlock/credentials.json (600 mode).")}\n`);
    }
  }

  return { provider, model, apiKey };
}

async function resolveProfile(
  rl: ReturnType<typeof createInterface>,
  profile: ScanProfile,
): Promise<RunProfile> {
  if (profile === "quick") return { tryRun: false, prDraft: false };
  if (profile === "deep") return { tryRun: true, prDraft: false };
  if (profile === "full") return { tryRun: true, prDraft: true };

  printSection("Step 3 · Custom Flags");
  const tryRun = await askBooleanWithArrows(rl, {
    title: "Try-run sandbox pass?",
    yesLabel: "Enable try-run",
    yesDescription: "Execute safe install/test/build/start commands with timeout.",
    noLabel: "Skip try-run",
    noDescription: "Only deterministic static analysis.",
    defaultValue: true,
  });
  const prDraft = await askBooleanWithArrows(rl, {
    title: "Generate PR draft output?",
    yesLabel: "Enable PR draft",
    yesDescription: "Create pr_draft.md with title, summary and checklist.",
    noLabel: "Skip PR draft",
    noDescription: "Do not generate PR draft artifact.",
    defaultValue: false,
  });
  return { tryRun, prDraft };
}

async function askModelChoice(
  rl: ReturnType<typeof createInterface>,
  provider: LlmProviderType,
  preferredModel?: string,
): Promise<string> {
  const options = getProviderModelOptions(provider);
  const recommended = getRecommendedModel(provider);
  const defaultModel = preferredModel || recommended || getProviderPreset(provider).model;

  const rows = [...options, { id: "__custom__", label: "Custom model ID", qualityTier: "balanced" as const }];
  let defaultIndex = rows.findIndex((row) => row.id === defaultModel);
  if (defaultIndex < 0) defaultIndex = 0;

  const selected = await askChoiceWithArrows(
    rl,
    rows.map((row) => {
      const tier = row.qualityTier === "max" ? "MAX" : row.qualityTier === "balanced" ? "BALANCED" : "FAST";
      const rec = row.id === recommended ? " (recommended)" : "";
      return {
        value: row.id,
        label: `${row.label} [${tier}]${rec}`,
        detail: row.id === "__custom__" ? undefined : row.id,
      } as ArrowChoice<string>;
    }),
    defaultIndex,
    "Model selection",
  );

  if (selected === "__custom__") {
    return promptRequired(rl, `${accent("Custom model ID")}: `);
  }
  return selected;
}

async function askChoice<T extends string>(
  rl: ReturnType<typeof createInterface>,
  choices: Choice<T>[],
  defaultIndex: number,
  title = "Option selection",
): Promise<T> {
  return askChoiceWithArrows(
    rl,
    choices.map((choice) => ({
      value: choice.value,
      label: choice.label,
      description: choice.description,
    })),
    defaultIndex,
    title,
  );
}

async function askBooleanWithArrows(
  rl: ReturnType<typeof createInterface>,
  prompt: BooleanPrompt,
): Promise<boolean> {
  const value = await askChoiceWithArrows(
    rl,
    [
      {
        value: "yes",
        label: prompt.yesLabel,
        description: prompt.yesDescription,
      },
      {
        value: "no",
        label: prompt.noLabel,
        description: prompt.noDescription,
      },
    ],
    prompt.defaultValue ? 0 : 1,
    prompt.title,
  );
  return value === "yes";
}

async function askChoiceWithArrows<T>(
  rl: ReturnType<typeof createInterface>,
  choices: ArrowChoice<T>[],
  defaultIndex: number,
  title: string,
): Promise<T> {
  if (choices.length === 0) {
    throw new Error(`No choices available for ${title}.`);
  }
  if (!stdin.isTTY || !stdout.isTTY) {
    return choices[Math.max(0, Math.min(defaultIndex, choices.length - 1))].value;
  }

  let selectedIndex = Math.max(0, Math.min(defaultIndex, choices.length - 1));
  const liveMenu = createLogUpdate(stdout, { showCursor: false });

  const render = () => {
    const lines: string[] = [];
    lines.push(`${accent(` ${title} `)} ${dim("(↑/↓, j/k, 1-9, Enter)")}`);
    for (let i = 0; i < choices.length; i += 1) {
      const choice = choices[i];
      const isSelected = i === selectedIndex;
      const prefix = isSelected ? accent("❯") : dim(" ");
      const label = isSelected ? bright(choice.label) : choice.label;
      lines.push(`${prefix} ${dim(`${i + 1}.`)} ${label}`);
      if (choice.description) lines.push(`  ${dim(choice.description)}`);
      if (choice.detail) lines.push(`  ${dim(choice.detail)}`);
    }
    lines.push(dim("Esc keeps the default option."));
    liveMenu(lines.join("\n"));
  };

  return new Promise<T>((resolve) => {
    rl.pause();
    readline.emitKeypressEvents(stdin);
    const wasRaw = stdin.isRaw;
    if (!wasRaw) stdin.setRawMode(true);
    stdin.resume();
    stdout.write("\x1b[?25l");

    const finish = (value: T, selectedLabel: string) => {
      stdin.off("keypress", onKeypress);
      if (!wasRaw) stdin.setRawMode(false);
      rl.resume();
      liveMenu.clear();
      liveMenu.done();
      stdout.write("\x1b[?25h");
      stdout.write(`${dim(`Selected: ${selectedLabel}`)}\n`);
      resolve(value);
    };

    const onKeypress = (input: string, key: readline.Key) => {
      if (key.name === "up" || input === "k") {
        selectedIndex = selectedIndex <= 0 ? choices.length - 1 : selectedIndex - 1;
        render();
        return;
      }
      if (key.name === "down" || input === "j") {
        selectedIndex = selectedIndex >= choices.length - 1 ? 0 : selectedIndex + 1;
        render();
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        finish(choices[selectedIndex].value, choices[selectedIndex].label);
        return;
      }
      if (/^[1-9]$/.test(input)) {
        const index = Number(input) - 1;
        if (index >= 0 && index < choices.length) {
          selectedIndex = index;
          render();
          finish(choices[selectedIndex].value, choices[selectedIndex].label);
        }
        return;
      }
      if (key.name === "escape") {
        const index = Math.max(0, Math.min(defaultIndex, choices.length - 1));
        finish(choices[index].value, choices[index].label);
        return;
      }
      if (key.ctrl && key.name === "c") {
        const index = Math.max(0, Math.min(defaultIndex, choices.length - 1));
        finish(choices[index].value, choices[index].label);
      }
    };

    stdin.on("keypress", onKeypress);
    render();
  });
}

async function promptRequired(
  rl: ReturnType<typeof createInterface>,
  question: string,
  validator?: (value: string) => boolean,
  invalidMessage = "Value cannot be empty.",
): Promise<string> {
  while (true) {
    const answer = (await rl.question(question)).trim();
    if (answer.length > 0 && (!validator || validator(answer))) {
      return answer;
    }
    stdout.write(`${warn(invalidMessage)}\n`);
  }
}

async function promptSecretRequired(
  rl: ReturnType<typeof createInterface>,
  question: string,
): Promise<string> {
  while (true) {
    const value = (await promptSecret(rl, question)).trim();
    if (value.length > 0) {
      return value;
    }
    stdout.write(`${warn("API key cannot be empty.")}\n`);
  }
}

async function promptSecret(
  rl: ReturnType<typeof createInterface>,
  question: string,
): Promise<string> {
  const canDisableEcho = stdin.isTTY && process.platform !== "win32";
  let echoDisabled = false;

  if (canDisableEcho) {
    const off = spawnSync("stty", ["-echo"], { stdio: "inherit" });
    echoDisabled = off.status === 0;
  }

  try {
    return await rl.question(question);
  } finally {
    if (echoDisabled) {
      spawnSync("stty", ["echo"], { stdio: "inherit" });
      stdout.write("\n");
    }
  }
}

function normalizeTimeout(value: string, fallback: number): string {
  const trimmed = value.trim();
  if (!trimmed) return String(fallback);
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return String(fallback);
  const clamped = Math.max(5, Math.min(3600, Math.floor(parsed)));
  return String(clamped);
}

function printSection(title: string): void {
  stdout.write(`\n${accent(title)}\n`);
}

function printPanel(title: string, lines: string[]): void {
  const width = Math.min(86, Math.max(56, ...lines.map((line) => line.length + 4), title.length + 4));
  const top = `╔${"═".repeat(width - 2)}╗`;
  const bottom = `╚${"═".repeat(width - 2)}╝`;
  const t = centerText(` ${title} `, width - 2);

  stdout.write(`${accent(top)}\n`);
  stdout.write(`${accent("║")}${bright(t)}${accent("║")}\n`);
  stdout.write(`${accent("╠")}${accent("═".repeat(width - 2))}${accent("╣")}\n`);
  for (const line of lines) {
    const padded = padRight(` ${line}`, width - 2);
    stdout.write(`${accent("║")}${padded}${accent("║")}\n`);
  }
  stdout.write(`${accent(bottom)}\n\n`);
}

function centerText(value: string, width: number): string {
  if (value.length >= width) return value.slice(0, width);
  const left = Math.floor((width - value.length) / 2);
  const right = width - value.length - left;
  return `${" ".repeat(left)}${value}${" ".repeat(right)}`;
}

function padRight(value: string, width: number): string {
  if (value.length >= width) return value.slice(0, width);
  return `${value}${" ".repeat(width - value.length)}`;
}

function style(text: string, code: number): string {
  if (!stdout.isTTY) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

function bright(text: string): string {
  return style(text, 97);
}

function accent(text: string): string {
  return style(text, 96);
}

function ok(text: string): string {
  return style(`✓ ${text}`, 92);
}

function warn(text: string): string {
  return style(`! ${text}`, 93);
}

function dim(text: string): string {
  return style(text, 90);
}

function shrink(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}

function isRecoverableLlmFailure(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("insufficient_quota") ||
    lower.includes("rate_limit") ||
    lower.includes("invalid_api_key") ||
    lower.includes("authentication") ||
    lower.includes("api key is missing") ||
    lower.includes("llm request failed (429)") ||
    lower.includes("llm request failed (401)")
  );
}

function buildRecoverySuggestions(message: string, provider: LlmProviderType): string[] {
  const lower = message.toLowerCase();
  if (lower.includes("insufficient_quota")) {
    return [
      `Provider '${provider}' quota appears exhausted.`,
      "Switch provider or choose a cheaper/faster model from the wizard.",
      "If continuing with same provider, verify billing/quota in provider dashboard.",
    ];
  }
  if (lower.includes("invalid_api_key") || lower.includes("authentication") || lower.includes("401")) {
    return [
      `Credentials for '${provider}' look invalid or expired.`,
      "Paste a fresh API key or switch provider.",
      "You can keep model choice and only replace the key.",
    ];
  }
  if (lower.includes("rate_limit") || lower.includes("429")) {
    return [
      `Provider '${provider}' returned a rate limit response.`,
      "Retry after a short wait or switch to a faster/lighter model.",
      "Switching provider immediately is usually the quickest recovery path.",
    ];
  }
  return [
    "Change provider/model/key and retry from recovery mode.",
    "If the same error repeats, run again with a different provider.",
  ];
}
