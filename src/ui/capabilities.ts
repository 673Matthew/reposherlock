export type UiThemeName = "mono" | "neon";

export interface TerminalCapabilities {
  isTTY: boolean;
  supportsUnicode: boolean;
  supportsColor: boolean;
  noColor: boolean;
  quiet: boolean;
  reducedMotion: boolean;
  animations: boolean;
  theme: UiThemeName;
}

export interface CapabilityOverrides {
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
  platform?: NodeJS.Platform;
  supportsUnicode?: boolean;
  supportsColor?: boolean;
}

export function detectTerminalCapabilities(overrides: CapabilityOverrides = {}): TerminalCapabilities {
  const env = overrides.env || process.env;
  const isTTY = overrides.isTTY ?? Boolean(process.stdout.isTTY);
  const platform = overrides.platform || process.platform;

  // Cinematic defaults are intentionally not controlled by env toggles.
  // Animation and output mode are driven by terminal capability and explicit CLI flags.
  const noColor = false;
  const quiet = false;

  const supportsUnicode = overrides.supportsUnicode ?? detectUnicode(platform, env);
  const supportsColor = overrides.supportsColor ?? isTTY;

  const reducedMotion = !isTTY;
  const animations = !quiet && !reducedMotion;

  const requestedTheme = normalizeTheme(env.REPOSHERLOCK_THEME);
  const theme: UiThemeName = supportsColor ? requestedTheme : "mono";

  return {
    isTTY,
    supportsUnicode,
    supportsColor,
    noColor,
    quiet,
    reducedMotion,
    animations,
    theme,
  };
}

export function normalizeTheme(value?: string): UiThemeName {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "mono") return "mono";
  return "neon";
}

function detectUnicode(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): boolean {
  if (platform !== "win32") {
    return true;
  }

  if (env.WT_SESSION || env.TERM_PROGRAM === "vscode") {
    return true;
  }

  const term = (env.TERM || "").toLowerCase();
  if (term.includes("xterm") || term.includes("utf")) {
    return true;
  }

  return false;
}
