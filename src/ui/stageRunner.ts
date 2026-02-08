import ora, { type Ora } from "ora";
import type { TerminalCapabilities } from "./capabilities.js";
import type { OutputRenderer } from "./renderer.js";
import { AnimationScheduler } from "./scheduler.js";
import type { UiTheme } from "./theme.js";
import { CINEMATIC_PANEL_WIDTH } from "./layout.js";

export interface StageEvent {
  type: "stage:start" | "stage:end" | "stage:error" | "metric:update";
  stage: string;
  ts: number;
  durationMs?: number;
  error?: string;
  metric?: Record<string, number>;
}

export interface WithStageOptions {
  hints?: string[];
  minStageMs?: number;
}

export interface SpinnerLike {
  text: string;
  start: () => SpinnerLike;
  succeed: (text?: string) => SpinnerLike;
  fail: (text?: string) => SpinnerLike;
  stop: () => SpinnerLike;
}

export type SpinnerFactory = (text: string, frames: string[]) => SpinnerLike;

export class StageRunner {
  private readonly listeners = new Set<(event: StageEvent) => void>();
  private readonly spinnerFactory: SpinnerFactory;
  private outputSuspended = false;
  private bufferedLines: Array<{ text: string; kind: "ok" | "err" | "plain" }> = [];
  private stageHeaderPrinted = false;

  constructor(
    private readonly renderer: OutputRenderer,
    private readonly scheduler: AnimationScheduler,
    private readonly capabilities: TerminalCapabilities,
    private readonly theme: UiTheme,
    spinnerFactory?: SpinnerFactory,
  ) {
    this.spinnerFactory = spinnerFactory || defaultSpinnerFactory;
  }

  onEvent(listener: (event: StageEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setOutputSuspended(suspended: boolean): void {
    this.outputSuspended = suspended;
  }

  resetRun(): void {
    this.outputSuspended = false;
    this.bufferedLines = [];
    this.stageHeaderPrinted = false;
  }

  flushBufferedOutput(): void {
    if (this.bufferedLines.length === 0) {
      return;
    }
    this.printStageHeaderIfNeeded();
    for (const line of this.bufferedLines) {
      if (line.kind === "ok") {
        this.renderer.line(this.theme.colors.ok(line.text));
      } else if (line.kind === "err") {
        this.renderer.line(this.theme.colors.err(line.text));
      } else {
        this.renderer.line(line.text);
      }
    }
    this.bufferedLines = [];
  }

  clearBufferedOutput(): void {
    this.bufferedLines = [];
  }

  emitMetric(stage: string, metric: Record<string, number>): void {
    this.emit({ type: "metric:update", stage, ts: Date.now(), metric });
  }

  async withStage<T>(stage: string, fn: () => Promise<T>, options: WithStageOptions = {}): Promise<T> {
    const hints = options.hints || [];
    const startedAt = Date.now();
    this.emit({ type: "stage:start", stage, ts: startedAt });

    let spinner: SpinnerLike | undefined;
    let hintTimer: NodeJS.Timeout | undefined;

    if (!this.capabilities.quiet && !this.outputSuspended) {
      this.printStageHeaderIfNeeded();
      if (this.capabilities.animations) {
        spinner = this.spinnerFactory(
          this.stageLabel(stage, hints[0]),
          this.theme.symbols.spinnerFrames,
        );
        spinner.start();

        if (hints.length > 1) {
          let hintIndex = 0;
          hintTimer = setInterval(() => {
            hintIndex = (hintIndex + 1) % hints.length;
            if (spinner) {
              spinner.text = this.stageLabel(stage, hints[hintIndex]);
            }
          }, 180);
        }
      } else {
        this.renderer.line(`[RepoSherlock] ${stage}${hints[0] ? ` (${hints[0]})` : ""}...`);
      }
    }

    try {
      const result = await fn();
      const actualMs = Date.now() - startedAt;
      await this.scheduler.enforceStageMinimum(actualMs, options.minStageMs);
      const doneText = `${this.theme.symbols.tick} [RepoSherlock] ${stage} done in ${actualMs}ms`;

      if (hintTimer) clearInterval(hintTimer);
      if (spinner) {
        spinner.succeed(this.theme.colors.ok(doneText));
      } else if (!this.capabilities.quiet && !this.outputSuspended) {
        this.renderer.line(this.theme.colors.ok(doneText));
      } else if (this.outputSuspended) {
        this.bufferedLines.push({ text: doneText, kind: "ok" });
      }

      this.emit({ type: "stage:end", stage, ts: Date.now(), durationMs: actualMs });
      return result;
    } catch (error) {
      const actualMs = Date.now() - startedAt;
      await this.scheduler.enforceStageMinimum(actualMs, options.minStageMs);
      const message = error instanceof Error ? error.message : String(error);
      const failText = `${this.theme.symbols.cross} [RepoSherlock] ${stage} failed in ${actualMs}ms: ${message}`;

      if (hintTimer) clearInterval(hintTimer);
      if (spinner) {
        spinner.fail(this.theme.colors.err(failText));
      } else if (!this.capabilities.quiet && !this.outputSuspended) {
        this.renderer.line(this.theme.colors.err(failText));
      } else if (this.outputSuspended) {
        this.bufferedLines.push({ text: failText, kind: "err" });
      }

      this.emit({ type: "stage:error", stage, ts: Date.now(), durationMs: actualMs, error: message });
      throw error;
    }
  }

  private emit(event: StageEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private stageLabel(stage: string, hint?: string): string {
    if (!hint) {
      return `[RepoSherlock] ${stage}...`;
    }
    return `[RepoSherlock] ${stage}... ${this.theme.colors.dim(`· ${hint}`)}`;
  }

  private printStageHeaderIfNeeded(): void {
    if (this.stageHeaderPrinted || this.capabilities.quiet) {
      return;
    }
    this.stageHeaderPrinted = true;
    this.renderer.panel("Stages", ["Live execution timeline"], { width: CINEMATIC_PANEL_WIDTH });
  }
}

function defaultSpinnerFactory(text: string, frames: string[]): SpinnerLike {
  const spinner = ora({
    text,
    spinner: {
      frames,
      interval: 80,
    },
    discardStdin: false,
  }) as Ora;

  const adapter: SpinnerLike = {
    get text() {
      return spinner.text;
    },
    set text(value: string) {
      spinner.text = value;
    },
    start: () => {
      spinner.start();
      return adapter;
    },
    succeed: (value?: string) => {
      spinner.succeed(value);
      return adapter;
    },
    fail: (value?: string) => {
      spinner.fail(value);
      return adapter;
    },
    stop: () => {
      spinner.stop();
      return adapter;
    },
  };

  return adapter;
}
