import path from "node:path";
import type { KeyFiles, PlannedCommand, RunPlan, TryRunPolicy } from "../types.js";
import { commandExists, readTextFileLimited } from "../utils/fs.js";

interface PackageLite {
  scripts?: Record<string, string>;
  bin?: string | Record<string, string>;
}

export interface BuildRunPlanInput {
  rootDir: string;
  keyFiles: KeyFiles;
  timeoutSeconds: number;
  tryRunPython: boolean;
  policy: TryRunPolicy;
}

export async function buildRunPlan(input: BuildRunPlanInput): Promise<RunPlan> {
  if (input.keyFiles.dockerCompose || input.keyFiles.dockerfile) {
    const dockerAvailable = await commandExists("docker");
    const cmds: PlannedCommand[] = [];

    if (input.keyFiles.dockerCompose) {
      cmds.push({
        command: "docker",
        args: ["compose", "up", "--build", "--abort-on-container-exit"],
        run: dockerAvailable,
        why: dockerAvailable
          ? "docker compose detected and docker binary available"
          : "docker compose detected but docker binary missing",
      });
    } else {
      cmds.push(
        {
          command: "docker",
          args: ["build", "-t", "reposherlock-target", "."],
          run: dockerAvailable,
          why: dockerAvailable ? "dockerfile detected" : "dockerfile detected but docker missing",
        },
        {
          command: "docker",
          args: ["run", "--rm", "reposherlock-target"],
          run: dockerAvailable,
          why: dockerAvailable ? "run built image" : "docker missing",
        },
      );
    }

    return {
      strategy: "docker",
      reason: "Docker artifacts found; prefer containerized run path.",
      proposedCommands: cmds.map(formatPlanned),
      executableCommands: sanitizeByPolicy(cmds, input.policy),
    };
  }

  if (input.keyFiles.packageJson) {
    const packageInfo = await loadPackageJson(input.rootDir, input.keyFiles.packageJson);
    const scripts = packageInfo?.scripts || {};
    const hasBun = Boolean(input.keyFiles.bunLock);
    const bunAvailable = await commandExists("bun");
    const npmAvailable = await commandExists("npm");
    const runner = hasBun && bunAvailable ? "bun" : "npm";
    const installCmd =
      runner === "bun"
        ? { command: "bun", args: ["install"] }
        : { command: "npm", args: ["ci"] };

    const selectedScripts = input.policy.scriptPriority.filter((name) => scripts[name]).slice(0, 3);

    const isCliProject = Boolean(packageInfo?.bin);
    const scriptCommands = selectedScripts.map<PlannedCommand>((name) => {
      const scriptBody = scripts[name] || "";
      const scriptSafety = evaluateScriptSafety(scriptBody, {
        bunAvailable,
        npmAvailable,
        policy: input.policy,
      });
      const scriptArgsTail =
        isCliProject && (name === "start" || name === "dev")
          ? ["--", "--help"]
          : [];

      if (runner === "bun") {
        return {
          command: "bun",
          args: ["run", name, ...scriptArgsTail],
          run: bunAvailable && scriptSafety.safe,
          why: scriptSafety.safe
            ? `package.json contains script '${name}'${scriptArgsTail.length ? " (CLI help mode)" : ""}`
            : `script '${name}' blocked by safe policy: ${scriptSafety.reason}`,
        };
      }

      return {
        command: "npm",
        args: ["run", name, ...scriptArgsTail],
        run: npmAvailable && scriptSafety.safe,
        why: scriptSafety.safe
          ? `package.json contains script '${name}'${scriptArgsTail.length ? " (CLI help mode)" : ""}`
          : `script '${name}' blocked by safe policy: ${scriptSafety.reason}`,
      };
    });

    const installRun =
      runner === "bun"
        ? bunAvailable
        : npmAvailable;

    const commands: PlannedCommand[] = [
      {
        ...installCmd,
        run: installRun,
        why:
          runner === "bun"
            ? bunAvailable
              ? "bun lock or bun preference detected"
              : "bun selected but unavailable"
            : npmAvailable
              ? "npm fallback for Node project"
              : "npm unavailable",
      },
      ...scriptCommands,
    ];

    if (commands.length === 1) {
      commands.push({
        command: runner,
        args: ["run", "start"],
        run: false,
        why: "no preferred scripts found",
      });
    }

    return {
      strategy: "node-bun",
      reason: "package.json detected; using script-based execution path.",
      proposedCommands: commands.map(formatPlanned),
      executableCommands: sanitizeByPolicy(commands, input.policy),
    };
  }

  if (input.keyFiles.requirementsTxt || input.keyFiles.pyprojectToml) {
    const pythonAvailable = await commandExists("python");
    const cmds: PlannedCommand[] = [];

    if (input.tryRunPython) {
      if (input.keyFiles.entrypoints[0]) {
        cmds.push({
          command: "python",
          args: [input.keyFiles.entrypoints[0]],
          run: pythonAvailable,
          why: "python entrypoint guessed from repository structure",
        });
      } else {
        cmds.push({
          command: "pytest",
          args: [],
          run: pythonAvailable,
          why: "no clear entrypoint; testing path attempted",
        });
      }
    } else {
      cmds.push({
        command: "python",
        args: ["-m", "pip", "install", "-r", "requirements.txt"],
        run: false,
        why: "Python run disabled unless --try-run-python is explicitly set",
      });
    }

    return {
      strategy: "python",
      reason: "Python project indicators detected.",
      proposedCommands: cmds.map(formatPlanned),
      executableCommands: sanitizeByPolicy(cmds, input.policy),
    };
  }

  return {
    strategy: "none",
    reason: "No supported run strategy detected.",
    proposedCommands: [],
    executableCommands: [],
  };
}

function sanitizeByPolicy(commands: PlannedCommand[], policy: TryRunPolicy): PlannedCommand[] {
  const allowedCommands = new Set(policy.allowedCommands.map((x) => x.toLowerCase()));
  return commands.map((cmd) => {
    if (!allowedCommands.has(cmd.command.toLowerCase())) {
      return {
        ...cmd,
        run: false,
        why: `${cmd.why}; command blocked by safe-exec policy`,
      };
    }
    return cmd;
  });
}

function formatPlanned(cmd: PlannedCommand): string {
  return `${cmd.command}${cmd.args.length ? ` ${cmd.args.join(" ")}` : ""}`;
}

function evaluateScriptSafety(
  scriptBody: string,
  capabilities: { bunAvailable: boolean; npmAvailable: boolean; policy: TryRunPolicy },
): { safe: boolean; reason: string } {
  const entrypoint = extractScriptEntrypoint(scriptBody);
  if (!entrypoint) {
    return { safe: false, reason: "empty script command" };
  }

  if (entrypoint === "bun" && !capabilities.bunAvailable) {
    return { safe: false, reason: "script requires bun but bun is unavailable" };
  }

  if (entrypoint === "npm" && !capabilities.npmAvailable) {
    return { safe: false, reason: "script requires npm but npm is unavailable" };
  }

  const blockedEntrypoints = new Set(capabilities.policy.blockedScriptEntrypoints.map((x) => x.toLowerCase()));
  if (blockedEntrypoints.has(entrypoint)) {
    return { safe: false, reason: `entrypoint '${entrypoint}' is blocklisted` };
  }

  const safeEntrypoints = new Set(capabilities.policy.allowedScriptEntrypoints.map((x) => x.toLowerCase()));
  if (!safeEntrypoints.has(entrypoint)) {
    return { safe: false, reason: `entrypoint '${entrypoint}' is not allowlisted` };
  }

  return { safe: true, reason: "allowlisted entrypoint" };
}

function extractScriptEntrypoint(scriptBody: string): string | null {
  const normalized = scriptBody.trim();
  if (!normalized) {
    return null;
  }

  // Handle env assignment prefixes: FOO=bar NODE_ENV=prod vite build
  const parts = normalized.split(/\s+/);
  for (const part of parts) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(part)) {
      continue;
    }
    return part.toLowerCase();
  }
  return null;
}

async function loadPackageJson(rootDir: string, relPath: string): Promise<PackageLite | null> {
  const absPath = path.join(rootDir, relPath);
  const { text } = await readTextFileLimited(absPath, 600_000).catch(() => ({ text: "", truncated: false }));
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as PackageLite;
  } catch {
    return null;
  }
}
