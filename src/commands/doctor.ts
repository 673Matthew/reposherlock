import type { DoctorCheck, DoctorReport } from "../types.js";
import { resolveLlmConfig } from "../llm/provider.js";
import { getStoredApiKeyForProvider, loadUserLlmCredentials } from "../utils/userConfig.js";
import { execWithLimit } from "../utils/exec.js";
import { commandExists } from "../utils/fs.js";
import { nowIso } from "../utils/time.js";

const TOOLS: Array<{ command: string; args: string[]; name: string }> = [
  { name: "git", command: "git", args: ["--version"] },
  { name: "docker", command: "docker", args: ["--version"] },
  { name: "bun", command: "bun", args: ["--version"] },
  { name: "node", command: "node", args: ["--version"] },
  { name: "npm", command: "npm", args: ["--version"] },
  { name: "python", command: "python", args: ["--version"] },
  { name: "tar", command: "tar", args: ["--version"] },
];

export async function doctorCommand(): Promise<void> {
  const checks: DoctorCheck[] = [];

  for (const tool of TOOLS) {
    const available = await commandExists(tool.command);
    if (!available) {
      checks.push({
        tool: tool.name,
        available: false,
        note: "command not found",
      });
      continue;
    }

    const result = await execWithLimit(tool.command, tool.args, {
      cwd: process.cwd(),
      timeoutMs: 8000,
      maxOutputChars: 4000,
    });

    const raw = `${result.stdout}\n${result.stderr}`.trim();
    const version = raw.split(/\r?\n/)[0] || "available";

    checks.push({
      tool: tool.name,
      available: result.exitCode === 0 || result.exitCode === 1,
      version,
    });
  }

  const llmConfig = resolveLlmConfig({
    maxChars: 80_000,
    perFileChars: 12_000,
  });
  const creds = await loadUserLlmCredentials();
  const storedKey = getStoredApiKeyForProvider(creds, llmConfig.provider);

  const report: DoctorReport = {
    timestamp: nowIso(),
    checks,
    llmEnv: {
      provider: llmConfig.provider,
      baseUrl: llmConfig.baseUrl,
      hasApiKey: Boolean(llmConfig.apiKey || storedKey),
      model: llmConfig.model,
    },
  };

  printDoctorReport(report);
}

function printDoctorReport(report: DoctorReport): void {
  process.stdout.write(`RepoSherlock Doctor - ${report.timestamp}\n`);

  for (const check of report.checks) {
    process.stdout.write(
      `- ${check.tool}: ${check.available ? "ok" : "missing"}${check.version ? ` (${check.version})` : ""}${
        check.note ? ` - ${check.note}` : ""
      }\n`,
    );
  }

  process.stdout.write("\nLLM Environment\n");
  process.stdout.write(`- Provider: ${report.llmEnv.provider}\n`);
  process.stdout.write(`- Base URL: ${report.llmEnv.baseUrl}\n`);
  process.stdout.write(`- Model: ${report.llmEnv.model}\n`);
  process.stdout.write(`- API key configured: ${report.llmEnv.hasApiKey ? "yes" : "no"}\n`);
}
