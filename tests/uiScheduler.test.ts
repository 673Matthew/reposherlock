import test from "node:test";
import assert from "node:assert/strict";
import { AnimationScheduler, computeArtificialDelay } from "../src/ui/scheduler.js";

test("computeArtificialDelay enforces minimum visibility with budget", () => {
  const delay = computeArtificialDelay({
    actualMs: 60,
    minVisibleMs: 350,
    remainingBudgetMs: 120,
    reducedMotion: false,
  });

  assert.equal(delay, 120);
});

test("AnimationScheduler enforces min stage duration", async () => {
  const waits: number[] = [];
  const scheduler = new AnimationScheduler({
    minStageMs: 350,
    maxArtificialDelayMs: 1200,
    reducedMotion: false,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });

  const result = await scheduler.enforceStageMinimum(90);
  assert.equal(result.artificialDelayMs, 260);
  assert.equal(result.totalVisibleMs, 350);
  assert.equal(waits[0], 260);
});
