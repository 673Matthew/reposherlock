import test from "node:test";
import assert from "node:assert/strict";
import { detectTerminalCapabilities } from "../src/ui/capabilities.js";
import { OutputRenderer } from "../src/ui/renderer.js";
import { AnimationScheduler } from "../src/ui/scheduler.js";
import { StageRunner } from "../src/ui/stageRunner.js";
import { createTheme } from "../src/ui/theme.js";

test("StageRunner respects scheduler maxArtificialDelayMs cap", async () => {
  const caps = detectTerminalCapabilities({
    isTTY: true,
    supportsColor: false,
    supportsUnicode: false,
    env: {
      REPOSHERLOCK_QUIET: "1",
    },
  });
  const theme = createTheme(caps);
  const renderer = new OutputRenderer(caps, theme);

  const waits: number[] = [];
  const scheduler = new AnimationScheduler({
    minStageMs: 300,
    maxArtificialDelayMs: 120,
    reducedMotion: false,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });

  const runner = new StageRunner(renderer, scheduler, caps, theme);

  await runner.withStage("A) Demo One", async () => undefined);
  await runner.withStage("B) Demo Two", async () => undefined);
  await runner.withStage("C) Demo Three", async () => undefined);

  const totalArtificial = waits.reduce((sum, value) => sum + value, 0);
  assert.equal(totalArtificial, 120);
  assert.equal(scheduler.usedArtificialDelayMs, 120);
});
