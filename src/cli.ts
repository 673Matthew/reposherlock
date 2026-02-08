#!/usr/bin/env node
import { Command } from "commander";
import { analyzeCommand } from "./commands/analyze.js";
import { reportCommand } from "./commands/report.js";
import { doctorCommand } from "./commands/doctor.js";
import { interactiveCommand } from "./commands/interactive.js";
import { uiDemoCommand } from "./commands/uiDemo.js";
import { SUPPORTED_LLM_PROVIDERS } from "./llm/provider.js";

const program = new Command();

program
  .name("reposherlock")
  .description(
    "Drop a GitHub repo URL or local path and get architecture map, quickstart, risks, and actionable issues.",
  )
  .argument("[repo_target]", "optional repository URL or local path (prefills interactive wizard)")
  .version("0.1.0")
  .option("--no-animation", "disable animated cli output")
  .option("--thinking", "show cinematic thinking lines during analysis")
  .option("--verbose", "verbose logging");

program
  .command("analyze")
  .description("Analyze a public GitHub repository URL or local path")
  .argument("<repo_url_or_path>", "GitHub repository URL or local directory path")
  .option("--out <dir>", "output directory", undefined)
  .option("--format <md,json>", "output format list", "md,json")
  .option("--depth <n>", "max directory traversal depth", "6")
  .option("--max-files <n>", "max number of files scanned", "2500")
  .option("--include-tests", "include tests in scan", true)
  .option("--no-include-tests", "exclude tests from scan")
  .option("--try-run", "attempt safe run sandbox pass", false)
  .option("--try-run-python", "allow python execution attempts", false)
  .option("--try-run-policy <path>", "path to try-run policy JSON")
  .option("--no-animation", "disable animated cli output")
  .option("--no-inline-report", "disable inline report sections in terminal")
  .option("--timeout <seconds>", "timeout for each run command", "120")
  .option("--no-network", "disable network usage (local path only)")
  .option("--redact-secrets", "redact secret matches in outputs", true)
  .option("--no-redact-secrets", "do not redact secret matches")
  .option("--verbose", "verbose logging")
  .option("--thinking", "show cinematic thinking lines during analysis", false)
  .option("--provider <provider>", `LLM provider (${SUPPORTED_LLM_PROVIDERS.join(", ")})`)
  .option("--model <string>", "LLM model override")
  .option("--api-key <key>", "LLM API key override (prefer environment or saved credentials)")
  .option("--llm-provider <provider>", "alias for --provider")
  .option("--llm-model <string>", "alias for --model")
  .option("--llm-api-key <key>", "alias for --api-key")
  .option("--llm-max-chars <n>", "max prompt chars", "80000")
  .option("--llm-per-file-chars <n>", "per file prompt cap", "12000")
  .option("--pr-draft", "generate optional PR draft artifact", false)
  .action(async (target, options) => {
    await analyzeCommand(target, options);
  });

program
  .command("ui-demo")
  .description("Preview cinematic CLI UI with simulated stages")
  .action(async () => {
    await uiDemoCommand();
  });

program
  .command("report")
  .description("Render summary for an existing analysis directory")
  .argument("<analysis_dir>", "analysis directory path")
  .option("--open", "open viewer/report with system app", false)
  .action(async (analysisDir, options) => {
    await reportCommand(analysisDir, options.open);
  });

program
  .command("doctor")
  .description("Check local environment tools and LLM environment")
  .action(async () => {
    await doctorCommand();
  });

program.action(async (repoTarget?: string) => {
  const options = program.opts<{ animation?: boolean; thinking?: boolean; verbose?: boolean }>();
  await interactiveCommand({
    noAnimation: options.animation === false,
    thinking: Boolean(options.thinking || options.verbose),
    target: repoTarget,
  });
});

program.parseAsync(process.argv).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[reposherlock] ${message}\n`);
  process.exitCode = 1;
});
