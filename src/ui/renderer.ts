import Table from "cli-table3";
import { createLogUpdate } from "log-update";
import type { TerminalCapabilities } from "./capabilities.js";
import type { UiTheme } from "./theme.js";

export interface RunPlanRow {
  key: string;
  value: string;
}

export interface RevealOptions {
  maxMs?: number;
  minStepMs?: number;
  maxStepMs?: number;
}

export interface PanelOptions {
  width?: number;
}

export class OutputRenderer {
  private readonly liveWriter = createLogUpdate(process.stdout, { showCursor: false });
  private liveActive = false;

  constructor(
    private readonly capabilities: TerminalCapabilities,
    private readonly theme: UiTheme,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
  ) {}

  getCaps(): TerminalCapabilities {
    return this.capabilities;
  }

  getTheme(): UiTheme {
    return this.theme;
  }

  line(text = ""): void {
    process.stdout.write(`${text}\n`);
  }

  lines(text: string): void {
    process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
  }

  section(title: string): void {
    const decorated = this.theme.colors.heading(title);
    this.line(decorated);
  }

  panel(title: string, lines: string[], options: PanelOptions = {}): void {
    if (this.capabilities.quiet) {
      this.line(`${title}:`);
      for (const line of lines) {
        this.line(`- ${line}`);
      }
      this.line();
      return;
    }

    const body = lines.length > 0 ? lines : [""];
    const contentWidth = Math.max(title.length + 2, ...body.map((line) => line.length + 2));
    const width = options.width
      ? clamp(options.width, 44, 120)
      : Math.min(96, Math.max(44, contentWidth + 2));

    const top = `${this.theme.box.tl}${this.theme.box.h.repeat(width - 2)}${this.theme.box.tr}`;
    const split = `${this.theme.box.lt}${this.theme.box.h.repeat(width - 2)}${this.theme.box.rt}`;
    const bottom = `${this.theme.box.bl}${this.theme.box.h.repeat(width - 2)}${this.theme.box.br}`;

    this.line(this.theme.colors.primary(top));
    this.line(`${this.theme.colors.primary(this.theme.box.v)}${center(`${title}`, width - 2)}${this.theme.colors.primary(this.theme.box.v)}`);
    this.line(this.theme.colors.primary(split));
    for (const line of body) {
      this.line(`${this.theme.colors.primary(this.theme.box.v)}${pad(` ${line}`, width - 2)}${this.theme.colors.primary(this.theme.box.v)}`);
    }
    this.line(this.theme.colors.primary(bottom));
    this.line();
  }

  kvTable(rows: Array<[string, string]>): void {
    if (rows.length === 0) {
      return;
    }
    const leftWidth = Math.max(...rows.map(([k]) => k.length)) + 2;
    for (const [key, value] of rows) {
      this.line(`${pad(key, leftWidth)}${value}`);
    }
  }

  asciiTable(headers: string[], rows: string[][]): void {
    const tableOptions: ConstructorParameters<typeof Table>[0] = {
      head: headers,
      style: {
        compact: true,
      },
    };
    if (this.capabilities.supportsColor) {
      tableOptions.style = {
        head: ["cyan"],
        border: ["gray"],
        compact: true,
      };
    }

    const table = new Table(tableOptions);
    for (const row of rows) {
      table.push(row);
    }
    this.line(table.toString());
  }

  bulletList(items: string[], indent = 0): void {
    const prefix = `${" ".repeat(Math.max(0, indent))}${this.theme.symbols.dot}`;
    for (const item of items) {
      this.line(`${prefix} ${item}`);
    }
  }

  codeBlock(text: string): void {
    this.line("```text");
    this.line(text);
    this.line("```");
  }

  liveUpdate(text: string): void {
    this.liveActive = true;
    this.liveWriter(text);
  }

  liveClear(): void {
    if (!this.liveActive) {
      return;
    }
    this.liveWriter.clear();
  }

  liveDone(): void {
    if (!this.liveActive) {
      return;
    }
    this.liveWriter.done();
    this.liveActive = false;
  }

  renderRunPlan(rows: RunPlanRow[]): void {
    const lines = rows.map((row) => `${row.key}: ${row.value}`);
    this.panel("Run Plan", lines);
  }

  async revealLines(lines: string[], options: RevealOptions = {}): Promise<void> {
    if (lines.length === 0) {
      return;
    }

    if (!this.capabilities.animations || this.capabilities.quiet) {
      for (const line of lines) {
        this.line(line);
      }
      return;
    }

    const maxMs = options.maxMs ?? 400;
    const minStepMs = options.minStepMs ?? 15;
    const maxStepMs = options.maxStepMs ?? 30;
    const perLine = clamp(Math.floor(maxMs / lines.length), minStepMs, maxStepMs);

    for (const line of lines) {
      this.line(line);
      await this.sleep(perLine);
    }
  }
}

function pad(value: string, width: number): string {
  if (value.length >= width) return value;
  return `${value}${" ".repeat(width - value.length)}`;
}

function center(value: string, width: number): string {
  if (value.length >= width) return value.slice(0, width);
  const left = Math.floor((width - value.length) / 2);
  const right = width - value.length - left;
  return `${" ".repeat(left)}${value}${" ".repeat(right)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
