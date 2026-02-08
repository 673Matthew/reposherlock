import fs from "node:fs/promises";
import path from "node:path";
import type { DeterministicSummary } from "../types.js";
import { execWithLimit } from "../utils/exec.js";
import { commandExists } from "../utils/fs.js";
import { printTerminalInsights } from "../utils/console.js";

interface ReportSummary {
  metadata?: {
    generatedAt?: string;
    repo?: {
      displayName?: string;
    };
  };
  summary?: DeterministicSummary;
  likelyPurpose?: string;
  envHints?: string[];
  detectedLicense?: string | null;
}

export async function reportCommand(analysisDir: string, open: boolean): Promise<void> {
  const absDir = path.resolve(process.cwd(), analysisDir);
  const reportPath = path.join(absDir, "report.md");
  const reportJsonPath = path.join(absDir, "report.json");
  const htmlPath = path.join(absDir, "report.html");
  const goodFirstPath = path.join(absDir, "issues.good-first.md");
  const prDraftPath = path.join(absDir, "pr_draft.md");

  const reportJsonText = await fs.readFile(reportJsonPath, "utf8").catch(() => "");
  if (!reportJsonText) {
    throw new Error(`Could not read report.json in ${absDir}`);
  }

  const reportJson = JSON.parse(reportJsonText) as ReportSummary;
  const summary = reportJson.summary;
  const risks = summary?.risks || [];
  const improvements = (summary?.issues || []).filter((issue) =>
    issue.labels.every((label) => {
      const lower = label.toLowerCase();
      return !(
        lower.includes("category:license") ||
        lower.includes("category:secret") ||
        lower.includes("category:dependency") ||
        lower.includes("category:ci")
      );
    }),
  );
  const high = risks.filter((r) => r.severity === "high").length;
  const med = risks.filter((r) => r.severity === "med").length;
  const low = risks.filter((r) => r.severity === "low").length;
  const improveHigh = improvements.filter((r) => r.severity === "high").length;
  const improveMed = improvements.filter((r) => r.severity === "med").length;
  const improveLow = improvements.filter((r) => r.severity === "low").length;
  const entrypoints = filterDisplayEntrypoints(summary?.keyFiles?.entrypoints || []);

  process.stdout.write("RepoSherlock Analysis Summary\n");
  process.stdout.write(`- Repo: ${reportJson.metadata?.repo?.displayName || "unknown"}\n`);
  process.stdout.write(`- Generated: ${reportJson.metadata?.generatedAt || "unknown"}\n`);
  process.stdout.write(`- Type: ${summary?.classification?.projectType || "unknown"}\n`);
  process.stdout.write(`- Runtime: ${summary?.classification?.runtime || "unknown"}\n`);
  process.stdout.write(
    `- Languages: ${(summary?.languageBreakdown || []).slice(0, 5).map((x) => x.language).join(", ") || "unknown"}\n`,
  );
  process.stdout.write(
    `- Entrypoints: ${entrypoints.slice(0, 5).join(", ") || "none"}\n`,
  );
  process.stdout.write(`- Risks: high=${high}, med=${med}, low=${low}\n`);
  process.stdout.write(`- Improvements: high=${improveHigh}, med=${improveMed}, low=${improveLow}\n`);
  process.stdout.write(`- Report: ${reportPath}\n`);
  process.stdout.write(`- HTML: ${htmlPath}\n`);
  if (await fileExists(goodFirstPath)) {
    process.stdout.write(`- Good First Issues: ${goodFirstPath}\n`);
  }
  if (await fileExists(prDraftPath)) {
    process.stdout.write(`- PR Draft: ${prDraftPath}\n`);
  }
  process.stdout.write("\n");

  if (summary) {
    await printTerminalInsights({
      summary,
      likelyPurpose:
        reportJson.likelyPurpose ||
        "Repo purpose is inferred heuristically from repository structure and may be incomplete.",
      envHints: reportJson.envHints || [],
      detectedLicense: reportJson.detectedLicense || null,
    });
  }

  if (open) {
    const target = await fileExists(htmlPath) ? htmlPath : reportPath;
    await openFile(target);
  }
}

async function openFile(filePath: string): Promise<void> {
  const platform = process.platform;

  if (platform === "darwin") {
    await execWithLimit("open", [filePath], { cwd: process.cwd(), timeoutMs: 10_000, maxOutputChars: 10_000 });
    return;
  }

  if (platform === "win32") {
    await execWithLimit("cmd", ["/c", "start", "", filePath], {
      cwd: process.cwd(),
      timeoutMs: 10_000,
      maxOutputChars: 10_000,
    });
    return;
  }

  if (await commandExists("xdg-open")) {
    await execWithLimit("xdg-open", [filePath], {
      cwd: process.cwd(),
      timeoutMs: 10_000,
      maxOutputChars: 10_000,
    });
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function filterDisplayEntrypoints(paths: string[]): string[] {
  const filtered = paths.filter((item) => {
    const lower = item.toLowerCase();
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
