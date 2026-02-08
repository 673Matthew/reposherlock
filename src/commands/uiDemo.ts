import { getUiRuntime } from "../ui/runtime.js";
import { IndeterminateProgress } from "../ui/progress.js";
import { ThinkingPanel } from "../ui/thinkingPanel.js";
import { printRunPlanPanel, showSherlockIntro, showSherlockThinking } from "../utils/console.js";

export async function uiDemoCommand(): Promise<void> {
  await showSherlockIntro("0.1.0");

  printRunPlanPanel({
    target: "https://github.com/octocat/Hello-World",
    llmEnabled: true,
    llmMandatory: true,
    provider: "openai",
    model: "gpt-5.2",
    tryRun: true,
    prDraft: true,
  });

  await showSherlockThinking([
    "Validating repository target and runtime profile",
    "Planning scan strategy and safe execution path",
    "Preparing architecture, risk, and issue synthesis",
  ]);

  const ui = getUiRuntime();
  ui.scheduler.resetRun();
  const stageRunner = ui.stageRunner;

  const progress = new IndeterminateProgress(ui.capabilities, ui.theme);

  await stageRunner.withStage("A) Ingest", async () => {
    progress.start("Resolving source and cloning metadata");
    await sleep(140);
    progress.complete();
  }, {
    hints: ["validating GitHub URL", "resolving source path", "capturing repository identity"],
  });

  await stageRunner.withStage("B) Scan + Understand", async () => {
    await sleep(90);
  }, {
    hints: ["indexing repository files", "parsing module imports", "building architecture map"],
  });

  await stageRunner.withStage("C) Risk Analysis", async () => {
    await sleep(80);
  }, {
    hints: ["checking license signals", "scanning for secret patterns", "evaluating dependency and CI risks"],
  });

  await stageRunner.withStage("D) Actionable Issues", async () => {
    await sleep(65);
  }, {
    hints: ["ranking findings by severity", "attaching reproducible evidence", "drafting good-first issues"],
  });

  await stageRunner.withStage("E) Try-Run Sandbox Pass", async () => {
    await sleep(120);
  }, {
    hints: ["planning safe executable commands", "running in temporary sandbox", "classifying execution outcomes"],
  });

  await stageRunner.withStage("F) LLM Polish Pass", async () => {
    const substeps = new ThinkingPanel(ui.renderer, ui.scheduler, ui.capabilities, ui.theme, {
      minPanelVisibleMs: 250,
    });
    const llmSteps = ["README polish", "Issues polish", "Report polish"];
    substeps.start(llmSteps);
    substeps.activate(0);
    await sleep(90);
    await substeps.complete(0);
    substeps.activate(1);
    await sleep(70);
    await substeps.complete(1);
    substeps.activate(2);
    await sleep(90);
    await substeps.complete(2);
    await substeps.stop({ finalize: true });
  }, {
    hints: ["building safe prompt pack", "polishing README, report, and issues", "preserving deterministic facts"],
  });

  ui.renderer.section("Summary");
  ui.renderer.kvTable([
    ["Repo type", "web"],
    ["Languages", "TypeScript, Markdown"],
    ["Risk count", "high=0, med=1, low=2"],
    ["Output", ".reposherlock/output/demo"],
    ["LLM", "enabled"],
  ]);
  ui.renderer.line();

  ui.renderer.section("Insights");
  await ui.renderer.revealLines([
    "What This Repo Does",
    "- Example repository used to preview cinematic CLI behavior.",
    "",
    "Try-Run Results",
  ], { maxMs: 320 });

  ui.renderer.asciiTable(
    ["Step", "Command", "Status", "Exit", "Time", "Note"],
    [
      ["install", "bun install", "verified", "0", "0.8s", "lockfile ok"],
      ["build", "bun run build", "verified", "0", "0.4s", "dist/ created"],
      ["start", "bun run start -- --help", "partial", "0", "0.2s", "help-only"],
    ],
  );
  ui.renderer.line("Legend: verified=confirmed signal, partial=indirect signal, failed=execution failed, skipped=not executed");
  ui.renderer.line();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
