import type { RunFailureClass } from "../types.js";

export function classifyRunFailure(stderr: string, stdout: string): RunFailureClass {
  const hay = `${stderr}\n${stdout}`.toLowerCase();

  if (
    hay.includes("missing") && hay.includes("env") ||
    hay.includes("process.env") ||
    hay.includes("must be set") && hay.includes("env") ||
    hay.includes("dotenv") && hay.includes("not found")
  ) {
    return "missing-env";
  }

  if (
    hay.includes("module not found") ||
    hay.includes("cannot find module") ||
    hay.includes("no such file or directory") ||
    hay.includes("not installed") ||
    hay.includes("command not found")
  ) {
    return "missing-deps";
  }

  if (hay.includes("eaddrinuse") || hay.includes("address already in use") || hay.includes("port is already allocated")) {
    return "port-conflict";
  }

  if (hay.includes("test failed") || hay.includes("failing tests") || hay.includes("assert") && hay.includes("failed")) {
    return "test-fail";
  }

  if (hay.includes("permission denied") || hay.includes("eacces")) {
    return "permission";
  }

  return "unknown";
}

export function probableFixesForFailure(kind: RunFailureClass): string[] {
  switch (kind) {
    case "missing-env":
      return [
        "Create a .env file from .env.example if available.",
        "Document required environment variables in README quickstart.",
      ];
    case "missing-deps":
      return [
        "Install dependencies with the detected package manager before running scripts.",
        "Check lockfile consistency and runtime version requirements.",
      ];
    case "port-conflict":
      return [
        "Change application port via environment variable or config.",
        "Stop existing process already bound to the target port.",
      ];
    case "test-fail":
      return [
        "Run a narrowed test subset to isolate failures.",
        "Review stack trace and update brittle snapshots/fixtures.",
      ];
    case "permission":
      return [
        "Check file execution permissions and current user access.",
        "Avoid writing to protected paths in setup scripts.",
      ];
    default:
      return ["Inspect stderr snippet for root cause and reproduce locally with full logs."];
  }
}
