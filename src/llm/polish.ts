import type { DeterministicSummary, IssueItem, LlmEnhancementOutput, LlmPromptPack } from "../types.js";
import type { LlmProvider } from "./provider.js";

export async function runLlmPolishPass(input: {
  provider: LlmProvider;
  promptPack: LlmPromptPack;
  deterministicReport: string;
  deterministicReadme: string;
  deterministicIssues: IssueItem[];
  summary: DeterministicSummary;
  substepHooks?: {
    onStart?: (key: "readme" | "issues" | "report", label: string) => void;
    onComplete?: (key: "readme" | "issues" | "report") => void;
    onError?: (key: "readme" | "issues" | "report", error: unknown) => void;
  };
}): Promise<LlmEnhancementOutput> {
  const notes = [input.promptPack.disclaimer];
  const purposeSummaryResult = await buildReadmePurposeSummary(input.provider, input.promptPack, input.summary);
  if (purposeSummaryResult.note) {
    notes.push(purposeSummaryResult.note);
  }

  const sharedContext = buildSharedContext(input.promptPack, input.summary, purposeSummaryResult.purposeSummary);

  const [readme, issuesText, report] = await Promise.all([
    runSubstep(input, "readme", "README polish", async () =>
      input.provider.complete([
        {
          role: "system",
          content:
            "Improve README clarity and structure. Preserve factual commands and paths exactly when provided. Do not invent facts.",
        },
        {
          role: "user",
          content: `${sharedContext}\n\nDeterministic README draft:\n${input.deterministicReadme}\n\nRewrite it as a clearer README 2.0 with sections: Quickstart, Run, Usage, Configuration, Troubleshooting.`,
        },
      ])),
    runSubstep(input, "issues", "Issues polish", async () =>
      input.provider.complete([
        {
          role: "system",
          content:
            "Improve GitHub issue wording for clarity. Preserve severity, confidence, and evidence references. Output strict JSON array only.",
        },
        {
          role: "user",
          content: `${sharedContext}\n\nCurrent issues JSON:\n${JSON.stringify(input.deterministicIssues, null, 2)}\n\nReturn improved JSON only.`,
        },
      ])),
    runSubstep(input, "report", "Report polish", async () =>
      input.provider.complete([
        {
          role: "system",
          content:
            "Polish markdown report wording only. Keep facts and commands unchanged. Keep the 'Purpose guess' line identical to the canonical purpose sentence from context. Add optional architecture explanation paragraph without inventing facts.",
        },
        {
          role: "user",
          content: `${sharedContext}\n\nCurrent report:\n${input.deterministicReport}\n\nReturn polished markdown report.`,
        },
      ])),
  ]);

  const parsedIssues = tryParseIssuesJson(issuesText, input.deterministicIssues);
  if (parsedIssues === input.deterministicIssues) {
    notes.push("LLM issue JSON parse failed; deterministic issues retained.");
  }

  return {
    purposeSummary: purposeSummaryResult.purposeSummary,
    readme,
    issuesJson: parsedIssues,
    report,
    notes,
  };
}

async function runSubstep(
  input: {
    substepHooks?: {
      onStart?: (key: "readme" | "issues" | "report", label: string) => void;
      onComplete?: (key: "readme" | "issues" | "report") => void;
      onError?: (key: "readme" | "issues" | "report", error: unknown) => void;
    };
  },
  key: "readme" | "issues" | "report",
  label: string,
  fn: () => Promise<string>,
): Promise<string> {
  input.substepHooks?.onStart?.(key, label);
  try {
    const result = await fn();
    input.substepHooks?.onComplete?.(key);
    return result;
  } catch (error) {
    input.substepHooks?.onError?.(key, error);
    throw error;
  }
}

function buildSharedContext(promptPack: LlmPromptPack, summary: DeterministicSummary, purposeSummary?: string): string {
  const excerpts = promptPack.excerpts
    .map((excerpt) => {
      const trunc = excerpt.truncated ? " (truncated)" : "";
      return `### ${excerpt.file}${trunc}\n${excerpt.content}`;
    })
    .join("\n\n");

  const purposeLine = purposeSummary
    ? `Canonical purpose sentence (must stay factual): ${purposeSummary}`
    : "Canonical purpose sentence: unavailable (README excerpt missing or insufficient)";

  return [
    promptPack.disclaimer,
    "Use only provided deterministic summary and excerpts.",
    "Never include secrets.",
    `Repository: ${summary.repoIdentity.displayName}`,
    purposeLine,
    "### Deterministic summary JSON",
    promptPack.summaryJson,
    "### File excerpts",
    excerpts || "(none)",
  ].join("\n\n");
}

async function buildReadmePurposeSummary(
  provider: LlmProvider,
  promptPack: LlmPromptPack,
  summary: DeterministicSummary,
): Promise<{ purposeSummary?: string; note?: string }> {
  const readmeExcerpts = promptPack.excerpts.filter((excerpt) => /(^|\/)readme/i.test(excerpt.file));
  if (readmeExcerpts.length === 0) {
    return { note: "README excerpt unavailable for LLM purpose summary; deterministic purpose retained." };
  }

  const excerpts = readmeExcerpts
    .slice(0, 2)
    .map((excerpt) => `### ${excerpt.file}\n${excerpt.content}`)
    .join("\n\n");

  const raw = await provider.complete([
    {
      role: "system",
      content:
        "You summarize repository purpose from README text only. Return one plain sentence (max 220 chars). No bullets, no markdown, no extra commentary.",
    },
    {
      role: "user",
      content: [
        promptPack.disclaimer,
        `Repository: ${summary.repoIdentity.displayName}`,
        "Task: Summarize what this repo does using only README excerpts below.",
        "If README is insufficient, return exactly UNKNOWN.",
        "",
        "### README excerpts",
        excerpts,
      ].join("\n"),
    },
  ]);

  const normalized = normalizePurposeSummary(raw);
  if (!normalized) {
    return { note: "LLM purpose summary was empty/invalid; deterministic purpose retained." };
  }

  return { purposeSummary: normalized };
}

function normalizePurposeSummary(value: string): string | undefined {
  const cleaned = value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\r/g, "")
    .trim();
  if (!cleaned) {
    return undefined;
  }

  const line = cleaned
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  if (!line) {
    return undefined;
  }

  const normalized = line
    .replace(/^[-*]\s+/, "")
    .replace(/^[0-9]+[.)]\s+/, "")
    .replace(/^["']+|["']+$/g, "")
    .trim();

  if (!normalized || /^unknown$/i.test(normalized)) {
    return undefined;
  }

  if (normalized.length <= 220) {
    return normalized;
  }
  return `${normalized.slice(0, 219).trimEnd()}…`;
}

function tryParseIssuesJson(value: string, fallback: IssueItem[]): IssueItem[] {
  const trimmed = value.trim();
  try {
    const parsed = JSON.parse(trimmed) as IssueItem[];
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // keep fallback
  }

  const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as IssueItem[];
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return fallback;
    }
  }

  return fallback;
}
