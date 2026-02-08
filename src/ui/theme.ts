import { Chalk } from "chalk";
import type { TerminalCapabilities, UiThemeName } from "./capabilities.js";

export interface UiTheme {
  name: UiThemeName;
  colors: {
    primary: (value: string) => string;
    heading: (value: string) => string;
    ok: (value: string) => string;
    warn: (value: string) => string;
    err: (value: string) => string;
    dim: (value: string) => string;
    accent: (value: string) => string;
    muted: (value: string) => string;
  };
  symbols: {
    tick: string;
    cross: string;
    dot: string;
    pointer: string;
    spinnerFrames: string[];
  };
  box: {
    tl: string;
    tr: string;
    bl: string;
    br: string;
    h: string;
    v: string;
    lt: string;
    rt: string;
  };
}

export function createTheme(capabilities: TerminalCapabilities): UiTheme {
  const chalk = new Chalk({ level: capabilities.supportsColor ? 3 : 0 });
  const identity = (value: string): string => value;

  const unicode = capabilities.supportsUnicode;
  const mono = capabilities.theme === "mono";

  const colors = mono
    ? {
        primary: identity,
        heading: identity,
        ok: identity,
        warn: identity,
        err: identity,
        dim: identity,
        accent: identity,
        muted: identity,
      }
    : {
        primary: (value: string) => chalk.hex("#00EAFF")(value),
        heading: (value: string) => chalk.hex("#00EAFF")(value),
        ok: (value: string) => chalk.hex("#59FF8C")(value),
        warn: (value: string) => chalk.hex("#FFD586")(value),
        err: (value: string) => chalk.hex("#FF6B7A")(value),
        dim: (value: string) => chalk.hex("#8FA1BA")(value),
        accent: (value: string) => chalk.hex("#6FA8FF")(value),
        muted: (value: string) => chalk.hex("#7C8CA3")(value),
      };

  const symbols = unicode
    ? {
        tick: mono ? "[ok]" : "✓",
        cross: mono ? "[x]" : "✕",
        dot: mono ? "*" : "•",
        pointer: mono ? ">" : "❯",
        spinnerFrames: mono ? ["-", "\\", "|", "/"] : ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
      }
    : {
        tick: "[ok]",
        cross: "[x]",
        dot: "*",
        pointer: ">",
        spinnerFrames: ["-", "\\", "|", "/"],
      };

  const box = unicode
    ? {
        tl: "╔",
        tr: "╗",
        bl: "╚",
        br: "╝",
        h: "═",
        v: "║",
        lt: "╠",
        rt: "╣",
      }
    : {
        tl: "+",
        tr: "+",
        bl: "+",
        br: "+",
        h: "-",
        v: "|",
        lt: "+",
        rt: "+",
      };

  return {
    name: capabilities.theme,
    colors,
    symbols,
    box,
  };
}
