import logUpdate from "log-update";
import type { TerminalCapabilities } from "./capabilities.js";
import { easeOutQuad } from "./scheduler.js";
import type { UiTheme } from "./theme.js";

export class IndeterminateProgress {
  private frame = 0;
  private timer: NodeJS.Timeout | undefined;
  private started = 0;
  private label = "Working";

  constructor(
    private readonly capabilities: TerminalCapabilities,
    private readonly theme: UiTheme,
  ) {}

  start(label: string): void {
    this.label = label;
    this.started = Date.now();

    if (!this.capabilities.animations || this.capabilities.quiet) {
      process.stdout.write(`${label}...\n`);
      return;
    }

    this.render();
    this.timer = setInterval(() => {
      this.frame += 1;
      this.render();
    }, 90);
  }

  complete(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    if (!this.capabilities.animations || this.capabilities.quiet) {
      return;
    }

    const elapsed = Math.max(1, Date.now() - this.started);
    const eased = easeOutQuad(1);
    const width = 28;
    const filled = Math.round(width * eased);
    const bar = `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
    logUpdate(`${this.theme.colors.primary(bar)} 100% ${this.theme.colors.ok(`${this.label} done in ${elapsed}ms`)}`);
    logUpdate.done();
  }

  private render(): void {
    const width = 28;
    const cursor = this.frame % width;
    const chars = new Array(width).fill("░");
    chars[cursor] = "█";
    const bar = chars.join("");
    logUpdate(`${this.theme.colors.primary(bar)} ${this.theme.colors.dim(this.label)}`);
  }
}
