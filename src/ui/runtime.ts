import { detectTerminalCapabilities, type TerminalCapabilities } from "./capabilities.js";
import { OutputRenderer } from "./renderer.js";
import { AnimationScheduler } from "./scheduler.js";
import { StageRunner } from "./stageRunner.js";
import { createTheme, type UiTheme } from "./theme.js";

export interface UiRuntime {
  capabilities: TerminalCapabilities;
  theme: UiTheme;
  scheduler: AnimationScheduler;
  renderer: OutputRenderer;
  stageRunner: StageRunner;
}

let runtime: UiRuntime | undefined;
let animationOverride: boolean | undefined;

export function setAnimationOverride(enabled: boolean): void {
  animationOverride = enabled;
  runtime = undefined;
}

export function getUiRuntime(): UiRuntime {
  if (runtime) {
    return runtime;
  }

  const baseCaps = detectTerminalCapabilities();
  const capabilities = applyAnimationOverride(baseCaps, animationOverride);
  const theme = createTheme(capabilities);
  const scheduler = new AnimationScheduler({
    reducedMotion: !capabilities.animations,
  });
  const renderer = new OutputRenderer(capabilities, theme);
  const stageRunner = new StageRunner(renderer, scheduler, capabilities, theme);

  runtime = {
    capabilities,
    theme,
    scheduler,
    renderer,
    stageRunner,
  };

  return runtime;
}

export function resetUiRuntime(): void {
  runtime = undefined;
}

function applyAnimationOverride(caps: TerminalCapabilities, override: boolean | undefined): TerminalCapabilities {
  if (override === undefined) {
    return caps;
  }

  if (!override) {
    return {
      ...caps,
      reducedMotion: true,
      animations: false,
    };
  }

  if (caps.quiet) {
    return {
      ...caps,
      animations: false,
    };
  }

  // Explicit enable only when terminal allows it.
  if (!caps.isTTY || caps.noColor || caps.reducedMotion) {
    return {
      ...caps,
      animations: false,
      reducedMotion: true,
    };
  }

  return {
    ...caps,
    animations: true,
    reducedMotion: false,
  };
}
