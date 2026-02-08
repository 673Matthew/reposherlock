import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "./fs.js";
import { nowIso } from "./time.js";
import type { Logger, StageLogEntry } from "../types.js";

export class JsonlLogger implements Logger {
  private logPath: string;

  constructor(logPath: string) {
    this.logPath = logPath;
  }

  async init(): Promise<void> {
    await ensureDir(path.dirname(this.logPath));
    await fs.writeFile(this.logPath, "", "utf8");
  }

  async log(entry: StageLogEntry): Promise<void> {
    const payload = { ...entry, ts: entry.ts || nowIso() };
    await fs.appendFile(this.logPath, `${JSON.stringify(payload)}\n`, "utf8");
  }

  async stageStart(stage: string, inputSummary?: Record<string, unknown>): Promise<number> {
    const startedAt = Date.now();
    await this.log({
      ts: nowIso(),
      stage,
      event: "start",
      inputSummary,
    });
    return startedAt;
  }

  async stageEnd(
    stage: string,
    startedAt: number,
    counts?: Record<string, number>,
    warnings?: string[],
  ): Promise<void> {
    await this.log({
      ts: nowIso(),
      stage,
      event: "end",
      durationMs: Date.now() - startedAt,
      counts,
      warnings,
    });
  }

  async stageError(stage: string, startedAt: number, error: unknown): Promise<void> {
    await this.log({
      ts: nowIso(),
      stage,
      event: "error",
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
