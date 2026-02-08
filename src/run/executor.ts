import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CommandExecution, RunAttemptResult, RunPlan } from "../types.js";
import { execWithLimit } from "../utils/exec.js";
import { copyDirRecursive } from "../utils/fs.js";
import { classifyRunFailure, probableFixesForFailure } from "./classify.js";

export interface RunExecutionInput {
  sourceRepoPath: string;
  plan: RunPlan;
  timeoutSeconds: number;
  maxOutputChars: number;
  onCommandEvent?: (event: RunCommandEvent) => void;
}

export interface RunCommandEvent {
  type: "start" | "progress" | "end" | "fallback";
  index: number;
  total: number;
  step: CommandExecution["step"];
  commandText: string;
  elapsedSeconds?: number;
  exitCode?: number | null;
  timedOut?: boolean;
  verificationStatus?: CommandExecution["verificationStatus"];
  note?: string;
}

export async function executeRunPlan(input: RunExecutionInput): Promise<RunAttemptResult> {
  if (input.plan.executableCommands.length === 0) {
    return {
      attempted: false,
      planner: input.plan,
      executions: [],
      summary: "No executable commands selected by planner.",
    };
  }

  const sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), "reposherlock-run-"));
  const runRepoPath = path.join(sandboxDir, "repo");
  const executions: CommandExecution[] = [];
  const runnable = input.plan.executableCommands.filter((cmd) => cmd.run);
  const totalRunnable = runnable.length;
  let runIndex = 0;
  let fallbackAttempted = false;

  try {
    await copyDirRecursive(input.sourceRepoPath, runRepoPath, {
      shouldSkip: (_src, name, isDirectory) => {
        if (!isDirectory) return false;
        return (
          name === ".git" ||
          name === ".reposherlock" ||
          name === "node_modules" ||
          name === "dist" ||
          name === "build" ||
          name === "coverage"
        );
      },
    });

    for (let commandIndex = 0; commandIndex < input.plan.executableCommands.length; commandIndex += 1) {
      const cmd = input.plan.executableCommands[commandIndex];
      if (!cmd.run) {
        continue;
      }

      runIndex += 1;
      const step = inferStep(cmd.command, cmd.args);
      const helpMode = isHelpMode(cmd.args);
      const commandText = `${cmd.command}${cmd.args.length ? ` ${cmd.args.join(" ")}` : ""}`;
      input.onCommandEvent?.({
        type: "start",
        index: runIndex,
        total: totalRunnable,
        step,
        commandText,
        note: `running ${step}: ${commandText}`,
      });
      const commandStartedAt = Date.now();
      let progressTimer: NodeJS.Timeout | undefined;
      if (input.onCommandEvent) {
        progressTimer = setInterval(() => {
          const elapsedSeconds = Math.max(1, Math.floor((Date.now() - commandStartedAt) / 1000));
          input.onCommandEvent?.({
            type: "progress",
            index: runIndex,
            total: totalRunnable,
            step,
            commandText,
            elapsedSeconds,
            note: `running ${step}: ${commandText} (${elapsedSeconds}s elapsed)`,
          });
        }, 5000);
      }
      const result = await (async () => {
        try {
          return await execWithLimit(cmd.command, cmd.args, {
            cwd: runRepoPath,
            timeoutMs: input.timeoutSeconds * 1000,
            maxOutputChars: input.maxOutputChars,
          });
        } finally {
          if (progressTimer) {
            clearInterval(progressTimer);
          }
        }
      })();

      const success = !result.timedOut && result.exitCode === 0;
      const classification = success ? "success" : classifyRunFailure(result.stderr, result.stdout);
      const probableFixes =
        classification === "success" ? [] : probableFixesForFailure(classification);
      const verification = await verifyExecution({
        step,
        helpMode,
        success,
        timedOut: result.timedOut,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        repoPath: runRepoPath,
        commandStartedAt,
        classification,
      });

      executions.push({
        command: result.command,
        args: result.args,
        step,
        helpMode,
        cwd: result.cwd,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        stdoutSnippet: clamp(result.stdout, input.maxOutputChars),
        stderrSnippet: clamp(result.stderr, input.maxOutputChars),
        classification,
        verificationStatus: verification.status,
        verificationEvidence: verification.evidence,
        probableFixes,
      });
      input.onCommandEvent?.({
        type: "end",
        index: runIndex,
        total: totalRunnable,
        step,
        commandText,
        elapsedSeconds: Math.max(0, Math.floor(result.durationMs / 1000)),
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        verificationStatus: verification.status,
        note: `completed ${step}: ${commandText} -> ${verification.status}`,
      });

      if (!success) {
        const fallbackAvailable = shouldContinueWithFallback({
          step,
          helpMode,
          timedOut: result.timedOut,
          commandIndex,
          commands: input.plan.executableCommands,
        });
        if (fallbackAvailable) {
          fallbackAttempted = true;
          input.onCommandEvent?.({
            type: "fallback",
            index: runIndex,
            total: totalRunnable,
            step,
            commandText,
            timedOut: result.timedOut,
            note: "start command timed out in help mode; trying fallback start command",
          });
          continue;
        }
        break;
      }
    }

    const attempted = executions.length > 0;
    const failedExecutions = executions.filter((exec) => exec.classification !== "success");
    const failed = failedExecutions.length > 0 ? failedExecutions[failedExecutions.length - 1] : undefined;
    const recoveredAfterFallback =
      fallbackAttempted &&
      failedExecutions.length > 0 &&
      executions.length > 0 &&
      executions[executions.length - 1].classification === "success";
    const summary =
      !attempted
        ? "No commands executed in sandbox."
        : recoveredAfterFallback
          ? "Run attempt recovered after start timeout via fallback command."
        : failed
          ? `Run attempt failed at '${failed.command} ${failed.args.join(" ")}'.`
          : buildSuccessSummary(executions);

    return {
      attempted,
      planner: input.plan,
      executions,
      summary,
    };
  } finally {
    await fs.rm(sandboxDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

interface FallbackDecisionInput {
  step: CommandExecution["step"];
  helpMode: boolean;
  timedOut: boolean;
  commandIndex: number;
  commands: RunPlan["executableCommands"];
}

function shouldContinueWithFallback(input: FallbackDecisionInput): boolean {
  if (input.step !== "start") return false;
  if (!input.helpMode) return false;
  if (!input.timedOut) return false;
  for (let index = input.commandIndex + 1; index < input.commands.length; index += 1) {
    const candidate = input.commands[index];
    if (!candidate.run) continue;
    const step = inferStep(candidate.command, candidate.args);
    if (step !== "start") continue;
    if (!isHelpMode(candidate.args)) continue;
    return true;
  }
  return false;
}

function clamp(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  return value.slice(value.length - limit);
}

interface VerificationInput {
  step: CommandExecution["step"];
  helpMode: boolean;
  success: boolean;
  timedOut: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  repoPath: string;
  commandStartedAt: number;
  classification: CommandExecution["classification"];
}

interface VerificationResult {
  status: CommandExecution["verificationStatus"];
  evidence: string;
}

async function verifyExecution(input: VerificationInput): Promise<VerificationResult> {
  if (!input.success) {
    if (input.timedOut) {
      return { status: "failed", evidence: "command timed out before verification could complete" };
    }
    return {
      status: "failed",
      evidence: `command failed with exit code ${input.exitCode ?? "null"} (${input.classification})`,
    };
  }

  const combined = `${input.stderr}\n${input.stdout}`.toLowerCase();

  if (input.step === "start" && input.helpMode) {
    return { status: "partial", evidence: "help output only; runtime startup was not verified" };
  }

  if (input.step === "install") {
    if (/(?:installed|added|dependencies|packages installed|up to date|lockfile)/i.test(combined)) {
      return { status: "verified", evidence: "dependency installation signal detected in logs" };
    }
    return { status: "partial", evidence: "exit code 0; install logs did not include strong dependency signal" };
  }

  if (input.step === "test") {
    if (/(?:\bpass\b|\bpassed\b|tests? passed|0 fail|ran \d+ tests?)/i.test(combined)) {
      return { status: "verified", evidence: "test pass signal detected in logs" };
    }
    return { status: "partial", evidence: "exit code 0; test pass markers were not confidently detected" };
  }

  if (input.step === "build") {
    const artifact = await detectBuildArtifact(input.repoPath, input.commandStartedAt);
    if (artifact) {
      return { status: "verified", evidence: `build artifact detected: ${artifact}` };
    }
    if (/(?:built|compiled|bundle|bundled|generated|transpil)/i.test(combined)) {
      return { status: "partial", evidence: "build-like log signal detected, but artifact verification was inconclusive" };
    }
    return { status: "partial", evidence: "exit code 0; no build artifact or strong build log signal detected" };
  }

  if (input.step === "start") {
    const port = detectPort(input.stdout) || detectPort(input.stderr);
    if (port) {
      return { status: "verified", evidence: `listening signal detected on port ${port}` };
    }
    if (/(?:listening|ready|started|running on|server started)/i.test(combined)) {
      return { status: "partial", evidence: "startup-like log signal detected without explicit port evidence" };
    }
    return { status: "partial", evidence: "exit code 0; no listening/ready signal was detected" };
  }

  if (input.step === "lint") {
    if (/(?:0 errors?|no issues?|lint passed)/i.test(combined)) {
      return { status: "verified", evidence: "lint success signal detected in logs" };
    }
    return { status: "partial", evidence: "exit code 0; lint success markers were not clearly detected" };
  }

  return { status: "partial", evidence: "command exited successfully; no dedicated verifier for this step" };
}

function inferStep(command: string, args: string[]): CommandExecution["step"] {
  const cmd = command.toLowerCase();
  const full = `${cmd} ${args.join(" ").toLowerCase()}`;

  if (cmd === "docker") {
    if (args.includes("build")) return "build";
    if (args.includes("compose") && args.includes("up")) return "start";
    if (args[0] === "run") return "start";
  }

  if (cmd === "pytest" || full.includes(" pytest")) return "test";
  if (cmd === "python" && args[0] === "-m" && args[1] === "pip") return "install";

  if (cmd === "npm" || cmd === "bun" || cmd === "pnpm" || cmd === "yarn") {
    if (args[0] === "install" || args[0] === "ci") return "install";
    if (args[0] === "test") return "test";
    if (args[0] === "run" && args[1]) {
      const script = args[1].toLowerCase();
      if (script.includes("test")) return "test";
      if (script.includes("lint")) return "lint";
      if (script.includes("build")) return "build";
      if (script.includes("start") || script.includes("dev") || script.includes("serve")) return "start";
      return "run";
    }
  }

  if (full.includes(" test")) return "test";
  if (full.includes(" lint")) return "lint";
  if (full.includes(" build")) return "build";
  if (full.includes(" start") || full.includes(" dev")) return "start";
  return "run";
}

function isHelpMode(args: string[]): boolean {
  const normalized = args.map((arg) => arg.trim().toLowerCase());
  return normalized.includes("--help") || normalized.includes("-h");
}

async function detectBuildArtifact(repoPath: string, startedAt: number): Promise<string | null> {
  const candidates = ["dist", "build", "out", ".next", "target"];
  for (const candidate of candidates) {
    const abs = path.join(repoPath, candidate);
    try {
      const stat = await fs.stat(abs);
      if (stat.isDirectory() && stat.mtimeMs >= startedAt - 1000) {
        return `${candidate}/`;
      }
    } catch {
      // ignore missing path
    }
  }
  return null;
}

function detectPort(output: string): string | null {
  const match =
    output.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/i) ||
    output.match(/listening(?:\s+on)?(?:\s+port)?\s+(\d{2,5})/i) ||
    output.match(/port\s+(\d{2,5})/i);
  if (!match) return null;
  return match[1] || null;
}

function buildSuccessSummary(executions: CommandExecution[]): string {
  const startExecution = executions.find((execution) => execution.step === "start");
  if (!startExecution) {
    return "Run attempt completed successfully for selected commands.";
  }

  if (startExecution.helpMode) {
    return "Run attempt completed successfully; start command ran in help mode only (startup not verified).";
  }

  if (startExecution.verificationStatus === "verified") {
    return "Run attempt completed successfully; startup verification signal was detected.";
  }

  return "Run attempt completed successfully; startup signal was not strongly verified.";
}
