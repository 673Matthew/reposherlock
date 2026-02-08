import { spawn } from "node:child_process";

export interface ExecOptions {
  cwd: string;
  timeoutMs: number;
  maxOutputChars: number;
  env?: NodeJS.ProcessEnv;
}

export interface ExecResult {
  command: string;
  args: string[];
  cwd: string;
  durationMs: number;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export async function execWithLimit(
  command: string,
  args: string[],
  options: ExecOptions,
): Promise<ExecResult> {
  const started = Date.now();
  let stdout = "";
  let stderr = "";
  let timedOut = false;

  return new Promise<ExecResult>((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const trim = (value: string): string => {
      if (value.length <= options.maxOutputChars) {
        return value;
      }
      return value.slice(value.length - options.maxOutputChars);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = trim(stdout + chunk.toString("utf8"));
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr = trim(stderr + chunk.toString("utf8"));
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1500);
    }, options.timeoutMs);

    const finalize = (exitCode: number | null) => {
      clearTimeout(timer);
      resolve({
        command,
        args,
        cwd: options.cwd,
        durationMs: Date.now() - started,
        exitCode,
        timedOut,
        stdout,
        stderr,
      });
    };

    child.on("error", (error) => {
      stderr = `${stderr}\n${String(error)}`.trim();
      finalize(-1);
    });

    child.on("close", (code) => finalize(code));
  });
}
