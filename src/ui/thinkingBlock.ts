import logUpdate from "log-update";
import type { TerminalCapabilities } from "./capabilities.js";
import type { OutputRenderer } from "./renderer.js";
import { AnimationScheduler } from "./scheduler.js";
import type { UiTheme } from "./theme.js";

interface ThinkingStep {
  id: string;
  text: string;
  state: "pending" | "active" | "done" | "failed";
}

export class ThinkingBlock {
  private steps: ThinkingStep[] = [];
  private frame = 0;
  private ticker: NodeJS.Timeout | undefined;
  private startedAt = 0;
  private title = "Sherlock Thinking";
  private counter = 0;

  constructor(
    private readonly renderer: OutputRenderer,
    private readonly scheduler: AnimationScheduler,
    private readonly capabilities: TerminalCapabilities,
    private readonly theme: UiTheme,
  ) {}

  start(title = "Sherlock Thinking"): void {
    this.title = title;
    this.startedAt = Date.now();

    if (this.capabilities.quiet) {
      return;
    }

    if (!this.capabilities.animations) {
      this.renderer.line(this.theme.colors.heading(this.title));
      return;
    }

    this.render();
    this.ticker = setInterval(() => {
      this.frame += 1;
      this.render();
    }, 90);
  }

  startStep(text: string): string {
    const id = `thinking-${this.counter++}`;
    this.steps.push({ id, text, state: "active" });

    // Keep one active step at a time unless caller explicitly runs parallel steps.
    const active = this.steps.filter((step) => step.state === "active");
    if (active.length > 1) {
      for (const step of this.steps) {
        if (step.id !== id && step.state === "active") {
          step.state = "pending";
        }
      }
    }

    this.render();
    return id;
  }

  completeStep(id: string): void {
    const step = this.steps.find((item) => item.id === id);
    if (!step) return;
    step.state = "done";

    const nextPending = this.steps.find((item) => item.state === "pending");
    if (nextPending) {
      nextPending.state = "active";
    }

    this.render();
  }

  failStep(id: string): void {
    const step = this.steps.find((item) => item.id === id);
    if (!step) return;
    step.state = "failed";
    this.render();
  }

  async runScripted(steps: string[], options: { stepMs?: number; minThinkingMs?: number } = {}): Promise<void> {
    const stepMs = options.stepMs ?? 140;
    const minThinkingMs = options.minThinkingMs ?? this.scheduler.minThinkingMs;

    this.start();

    for (const line of steps) {
      const id = this.startStep(line);
      if (this.capabilities.animations && stepMs > 0) {
        await sleep(stepMs);
      }
      this.completeStep(id);
    }

    const actualMs = Date.now() - this.startedAt;
    await this.scheduler.enforceThinkingMinimum(actualMs, minThinkingMs);
    this.finish();
  }

  finish(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }

    if (this.capabilities.quiet) {
      return;
    }

    if (this.capabilities.animations) {
      this.render();
      logUpdate.done();
      this.renderer.line();
      return;
    }

    for (const step of this.steps) {
      const prefix = step.state === "failed"
        ? this.theme.colors.err(`${this.theme.symbols.cross}`)
        : this.theme.colors.ok(`${this.theme.symbols.tick}`);
      this.renderer.line(`  ${prefix} ${step.text}`);
    }
    this.renderer.line();
  }

  private render(): void {
    if (this.capabilities.quiet) {
      return;
    }

    if (!this.capabilities.animations) {
      return;
    }

    const output: string[] = [];
    output.push(this.theme.colors.heading(this.title));

    for (const step of this.steps) {
      if (step.state === "done") {
        output.push(`  ${this.theme.colors.ok(this.theme.symbols.tick)} ${step.text}`);
        continue;
      }
      if (step.state === "failed") {
        output.push(`  ${this.theme.colors.err(this.theme.symbols.cross)} ${step.text}`);
        continue;
      }
      if (step.state === "active") {
        const frame = this.theme.symbols.spinnerFrames[this.frame % this.theme.symbols.spinnerFrames.length];
        output.push(`  ${this.theme.colors.primary(frame)} ${this.theme.colors.dim(step.text)}`);
        continue;
      }
      output.push(`  ${this.theme.colors.muted(this.theme.symbols.dot)} ${this.theme.colors.muted(step.text)}`);
    }

    const block = output.join("\n");
    logUpdate(block);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
