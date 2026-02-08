import cliCursor from "cli-cursor";
import type { TerminalCapabilities } from "./capabilities.js";
import type { OutputRenderer } from "./renderer.js";
import { AnimationScheduler, easeOutQuad } from "./scheduler.js";
import type { StageEvent } from "./stageRunner.js";
import type { UiTheme } from "./theme.js";
import { CINEMATIC_PANEL_WIDTH } from "./layout.js";

type StepState = "pending" | "active" | "done" | "failed";
type StageStatus = "pending" | "running" | "done" | "failed";

interface ThinkingStep {
  text: string;
  state: StepState;
  activatedAtMs?: number;
  completedAtMs?: number;
}

interface StageTrack {
  label: string;
  status: StageStatus;
  durationMs?: number;
  error?: string;
}

interface StopOptions {
  finalize: boolean;
}

export class ThinkingPanel {
  private steps: ThinkingStep[] = [];
  private activeIndex = -1;
  private frame = 0;
  private ticker: NodeJS.Timeout | undefined;
  private startedAtMs = 0;
  private noteText = "";
  private running = false;
  private disposed = false;
  private renderDirty = false;
  private transition: { from: number; to: number; startedAtMs: number; durationMs: number } | undefined;
  private cursorHidden = false;
  private readonly fpsIntervalMs = 33;
  private readonly minStepVisibleMs = 250;
  private readonly minPanelVisibleMs: number;
  private readonly panelWidth = CINEMATIC_PANEL_WIDTH;
  private readonly panelContentWidth = this.panelWidth - 2;
  private readonly thinkingBoxRows = 4;
  private readonly stageBoxRows = 7;
  private stageTracks: StageTrack[] = [];
  private stageTrackIndex = new Map<string, number>();

  private sigintHandler?: () => void;
  private sigtermHandler?: () => void;
  private exitHandler?: () => void;

  constructor(
    private readonly renderer: OutputRenderer,
    private readonly scheduler: AnimationScheduler,
    private readonly capabilities: TerminalCapabilities,
    private readonly theme: UiTheme,
    options: { minPanelVisibleMs?: number } = {},
  ) {
    this.minPanelVisibleMs = options.minPanelVisibleMs ?? 700;
  }

  start(steps: string[]): void {
    if (this.disposed) {
      return;
    }

    this.steps = steps.map((text) => ({ text, state: "pending" }));
    this.activeIndex = -1;
    this.noteText = "";
    this.frame = 0;
    this.startedAtMs = Date.now();
    this.running = true;
    this.stageTracks = [];
    this.stageTrackIndex.clear();

    if (!this.capabilities.animations || this.capabilities.quiet) {
      return;
    }

    this.installSignalHandlers();
    cliCursor.hide();
    this.cursorHidden = true;

    this.ticker = setInterval(() => {
      this.frame += 1;
      this.render();
    }, this.fpsIntervalMs);

    this.render();
  }

  activate(index: number): void {
    if (!this.running || this.disposed) {
      return;
    }
    if (index < 0 || index >= this.steps.length) {
      return;
    }

    const now = Date.now();
    const prev = this.activeIndex;
    if (prev >= 0 && prev < this.steps.length && this.steps[prev].state === "active") {
      this.steps[prev].state = "pending";
    }

    this.activeIndex = index;
    this.steps[index].state = "active";
    this.steps[index].activatedAtMs = now;
    this.steps[index].completedAtMs = undefined;
    this.transition = {
      from: prev,
      to: index,
      startedAtMs: now,
      durationMs: 250,
    };
    this.renderDirty = true;
    if (!this.capabilities.animations) {
      return;
    }
    this.render();
  }

  async complete(index: number): Promise<void> {
    if (!this.running || this.disposed) {
      return;
    }
    if (index < 0 || index >= this.steps.length) {
      return;
    }

    if (this.capabilities.animations) {
      const activatedAt = this.steps[index].activatedAtMs ?? Date.now();
      await this.scheduler.enforceSince(activatedAt, this.minStepVisibleMs);
    }

    this.steps[index].state = "done";
    this.steps[index].completedAtMs = Date.now();
    if (this.activeIndex === index) {
      this.activeIndex = -1;
    }
    this.noteText = "";
    this.renderDirty = true;

    if (!this.capabilities.animations) {
      return;
    }

    this.render();
  }

  fail(index: number): void {
    if (!this.running || this.disposed) {
      return;
    }
    if (index < 0 || index >= this.steps.length) {
      return;
    }
    this.steps[index].state = "failed";
    if (this.activeIndex === index) {
      this.activeIndex = -1;
    }
    this.renderDirty = true;
    this.render();
  }

  note(text: string): void {
    if (!this.running || this.disposed) {
      return;
    }
    this.noteText = text;
    this.renderDirty = true;

    if (!this.capabilities.animations) {
      return;
    }

    this.render();
  }

  setPlannedStages(stageLabels: string[]): void {
    this.stageTracks = [];
    this.stageTrackIndex.clear();
    for (const stageLabel of stageLabels) {
      this.ensureStageTrack(stageLabel, "pending");
    }
    this.renderDirty = true;
    if (this.capabilities.animations) {
      this.render();
    }
  }

  onStageEvent(event: StageEvent): void {
    if (this.disposed) {
      return;
    }
    if (event.type === "metric:update") {
      return;
    }

    const label = event.stage;
    if (!label) {
      return;
    }

    if (event.type === "stage:start") {
      this.ensureStageTrack(label, "running");
      this.renderDirty = true;
      this.render();
      return;
    }

    if (event.type === "stage:end") {
      const track = this.ensureStageTrack(label, "done");
      track.durationMs = event.durationMs;
      track.error = undefined;
      this.renderDirty = true;
      this.render();
      return;
    }

    if (event.type === "stage:error") {
      const track = this.ensureStageTrack(label, "failed");
      track.durationMs = event.durationMs;
      track.error = event.error;
      this.renderDirty = true;
      this.render();
    }
  }

  async stop(options: StopOptions = { finalize: true }): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    if (this.running && this.capabilities.animations) {
      await this.scheduler.enforceSince(this.startedAtMs, this.minPanelVisibleMs);
    }

    this.running = false;

    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }

    let finalBlock = "";
    if (options.finalize) {
      finalBlock = this.buildFinalLines().join("\n");
    }

    if (this.capabilities.animations && !this.capabilities.quiet) {
      if (options.finalize) {
        this.renderer.liveUpdate(finalBlock);
      } else {
        this.renderer.liveClear();
      }
      this.renderer.liveDone();
      if (options.finalize) {
        this.renderer.line();
      }
    } else if (options.finalize && !this.capabilities.quiet) {
      this.printFinalSummary();
    }

    this.restoreCursor();
    this.detachSignalHandlers();
  }

  private render(): void {
    if (!this.capabilities.animations || this.capabilities.quiet || !this.running) {
      return;
    }

    if (!this.renderDirty && this.frame % 2 !== 0) {
      // ~15fps when no state transitions to reduce CPU.
      return;
    }
    this.renderDirty = false;

    const lines: string[] = [];
    this.pushThinkingBox(lines);

    lines.push("");
    this.pushStagesBox(lines, this.noteText || "Live execution timeline");

    // Keep a stable panel height to avoid terminal jumping.
    const minLines = this.thinkingBoxRows + this.stageBoxRows + 11;
    while (lines.length < minLines) {
      lines.push(" ");
    }

    this.renderer.liveUpdate(lines.join("\n"));
  }

  private revealFraction(startedAtMs: number, durationMs: number): number {
    const elapsed = Math.max(0, Date.now() - startedAtMs);
    const progress = Math.max(0, Math.min(1, elapsed / durationMs));
    return easeOutQuad(progress);
  }

  private slideIndent(stepIndex: number): number {
    if (!this.transition || this.transition.to !== stepIndex) {
      return 1;
    }
    const elapsed = Date.now() - this.transition.startedAtMs;
    const progress = Math.max(0, Math.min(1, elapsed / this.transition.durationMs));
    const eased = easeOutQuad(progress);
    return Math.max(0, 4 - Math.round(eased * 3));
  }

  private printFinalSummary(): void {
    this.renderer.lines(this.buildFinalLines().join("\n"));
    this.renderer.line();
  }

  private buildFinalLines(): string[] {
    const lines: string[] = [];
    this.pushThinkingBox(lines);
    lines.push("");
    this.pushStagesBox(lines, "Live execution timeline", true);
    return lines;
  }

  private installSignalHandlers(): void {
    this.sigintHandler = () => {
      this.restoreCursor();
      process.exit(130);
    };
    this.sigtermHandler = () => {
      this.restoreCursor();
      process.exit(143);
    };
    this.exitHandler = () => {
      this.restoreCursor();
    };

    process.once("SIGINT", this.sigintHandler);
    process.once("SIGTERM", this.sigtermHandler);
    process.once("exit", this.exitHandler);
  }

  private detachSignalHandlers(): void {
    if (this.sigintHandler) {
      process.off("SIGINT", this.sigintHandler);
      this.sigintHandler = undefined;
    }
    if (this.sigtermHandler) {
      process.off("SIGTERM", this.sigtermHandler);
      this.sigtermHandler = undefined;
    }
    if (this.exitHandler) {
      process.off("exit", this.exitHandler);
      this.exitHandler = undefined;
    }
  }

  private restoreCursor(): void {
    if (this.cursorHidden) {
      cliCursor.show();
      this.cursorHidden = false;
    }
  }

  private pushStagesBox(lines: string[], note: string, finalized = false): void {
    const box = this.theme.box;
    const title = "Stages";
    const contentWidth = this.panelContentWidth;
    const top = `${box.tl}${box.h.repeat(contentWidth)}${box.tr}`;
    const split = `${box.lt}${box.h.repeat(contentWidth)}${box.rt}`;
    const bottom = `${box.bl}${box.h.repeat(contentWidth)}${box.br}`;

    lines.push(this.theme.colors.primary(top));
    lines.push(
      `${this.theme.colors.primary(box.v)}${this.theme.colors.heading(center(title, contentWidth))}${this.theme.colors.primary(box.v)}`,
    );
    lines.push(this.theme.colors.primary(split));
    for (const stageRow of this.buildStageRows(note, finalized)) {
      const row = pad(` ${shrink(stageRow.text, contentWidth - 1)}`, contentWidth);
      lines.push(`${this.theme.colors.primary(box.v)}${stageRow.color(row)}${this.theme.colors.primary(box.v)}`);
    }
    lines.push(this.theme.colors.primary(bottom));
  }

  private pushThinkingBox(lines: string[]): void {
    const box = this.theme.box;
    const contentWidth = this.panelContentWidth;
    const top = `${box.tl}${box.h.repeat(contentWidth)}${box.tr}`;
    const split = `${box.lt}${box.h.repeat(contentWidth)}${box.rt}`;
    const bottom = `${box.bl}${box.h.repeat(contentWidth)}${box.br}`;

    lines.push(this.theme.colors.primary(top));
    lines.push(
      `${this.theme.colors.primary(box.v)}${this.theme.colors.heading(center("Sherlock Thinking", contentWidth))}${this.theme.colors.primary(box.v)}`,
    );
    lines.push(this.theme.colors.primary(split));

    const rows = this.buildThinkingRows();
    for (const row of rows) {
      const text = pad(` ${shrink(row.text, contentWidth - 1)}`, contentWidth);
      lines.push(`${this.theme.colors.primary(box.v)}${row.color(text)}${this.theme.colors.primary(box.v)}`);
    }

    lines.push(this.theme.colors.primary(bottom));
  }

  private buildThinkingRows(): Array<{ text: string; color: (value: string) => string }> {
    const rows: Array<{ text: string; color: (value: string) => string }> = [];
    for (let i = 0; i < this.steps.length; i += 1) {
      const step = this.steps[i];
      if (step.state === "done") {
        const justDone = step.completedAtMs !== undefined && Date.now() - step.completedAtMs < 120;
        const doneColor = justDone ? this.theme.colors.accent : this.theme.colors.ok;
        rows.push({
          text: `${this.theme.symbols.tick} ${step.text}`,
          color: doneColor,
        });
        continue;
      }

      if (step.state === "failed") {
        rows.push({
          text: `${this.theme.symbols.cross} ${step.text}`,
          color: this.theme.colors.err,
        });
        continue;
      }

      if (step.state === "active") {
        const activatedAt = step.activatedAtMs ?? Date.now();
        const elapsed = Math.max(0, Date.now() - activatedAt);
        const displayed = elapsed < 150
          ? "..."
          : revealText(step.text, this.revealFraction(activatedAt + 150, 300));
        const spinner = this.theme.symbols.spinnerFrames[this.frame % this.theme.symbols.spinnerFrames.length];
        const transitionIndent = this.slideIndent(i);
        rows.push({
          text: `${" ".repeat(transitionIndent)}${this.theme.symbols.pointer} ${spinner} ${displayed}`,
          color: this.theme.colors.accent,
        });
        continue;
      }

      rows.push({
        text: `${this.theme.symbols.dot} ${step.text}`,
        color: this.theme.colors.muted,
      });
    }

    while (rows.length < this.thinkingBoxRows) {
      rows.push({
        text: "",
        color: this.theme.colors.dim,
      });
    }

    return rows.slice(0, this.thinkingBoxRows);
  }

  private buildStageRows(
    note: string,
    finalized: boolean,
  ): Array<{ text: string; color: (value: string) => string }> {
    const rows: Array<{ text: string; color: (value: string) => string }> = [];

    if (this.stageTracks.length > 0) {
      for (const track of this.stageTracks.slice(0, this.stageBoxRows)) {
        rows.push(this.formatStageTrack(track, finalized));
      }
    } else {
      rows.push({
        text: note,
        color: this.theme.colors.dim,
      });
    }

    while (rows.length < this.stageBoxRows) {
      if (rows.length === this.stageBoxRows - 1 && note) {
        rows.push({
          text: note,
          color: this.theme.colors.dim,
        });
      } else {
        rows.push({
          text: "",
          color: this.theme.colors.dim,
        });
      }
    }

    return rows.slice(0, this.stageBoxRows);
  }

  private formatStageTrack(
    track: StageTrack,
    finalized: boolean,
  ): { text: string; color: (value: string) => string } {
    const label = `[RepoSherlock] ${track.label}`;
    if (track.status === "done") {
      const duration = track.durationMs !== undefined ? ` in ${track.durationMs}ms` : "";
      return {
        text: `${this.theme.symbols.tick} ${label} done${duration}`,
        color: this.theme.colors.ok,
      };
    }

    if (track.status === "failed") {
      const errorSuffix = track.error ? `: ${track.error}` : "";
      return {
        text: `${this.theme.symbols.cross} ${label} failed${errorSuffix}`,
        color: this.theme.colors.err,
      };
    }

    if (track.status === "running") {
      if (finalized) {
        return {
          text: `${this.theme.symbols.dot} ${label}`,
          color: this.theme.colors.dim,
        };
      }
      const spinner = this.theme.symbols.spinnerFrames[this.frame % this.theme.symbols.spinnerFrames.length];
      return {
        text: `${this.theme.symbols.pointer} ${spinner} ${label}`,
        color: this.theme.colors.accent,
      };
    }

    return {
      text: `${this.theme.symbols.dot} ${label}`,
      color: this.theme.colors.muted,
    };
  }

  private ensureStageTrack(label: string, status: StageStatus): StageTrack {
    const existingIndex = this.stageTrackIndex.get(label);
    if (existingIndex !== undefined) {
      const existing = this.stageTracks[existingIndex];
      existing.status = status;
      return existing;
    }

    const next: StageTrack = {
      label,
      status,
    };
    this.stageTracks.push(next);
    this.stageTrackIndex.set(label, this.stageTracks.length - 1);
    return next;
  }
}

function revealText(value: string, fraction: number): string {
  const safeFraction = Math.max(0, Math.min(1, fraction));
  const visible = Math.max(1, Math.ceil(value.length * safeFraction));
  if (visible >= value.length) {
    return value;
  }
  return `${value.slice(0, visible)}${" ".repeat(value.length - visible)}`;
}

function pad(value: string, width: number): string {
  if (value.length >= width) return value.slice(0, width);
  return `${value}${" ".repeat(width - value.length)}`;
}

function center(value: string, width: number): string {
  if (value.length >= width) return value.slice(0, width);
  const left = Math.floor((width - value.length) / 2);
  const right = width - value.length - left;
  return `${" ".repeat(left)}${value}${" ".repeat(right)}`;
}

function shrink(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
