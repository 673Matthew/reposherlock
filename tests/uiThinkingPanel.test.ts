import test from "node:test";
import assert from "node:assert/strict";
import { AnimationScheduler } from "../src/ui/scheduler.js";
import { ThinkingPanel } from "../src/ui/thinkingPanel.js";
import { createTheme } from "../src/ui/theme.js";
import { detectTerminalCapabilities } from "../src/ui/capabilities.js";

test("ThinkingPanel prints only final static summary when animations are disabled", async () => {
  const sections: string[] = [];
  const lines: string[] = [];

  const renderer = {
    section: (value: string) => {
      sections.push(value);
    },
    line: (value = "") => {
      lines.push(value);
    },
    lines: (value: string) => {
      lines.push(value);
    },
    liveUpdate: () => {
      throw new Error("liveUpdate should not be called in non-animated mode");
    },
    liveClear: () => {},
    liveDone: () => {},
  };

  const caps = detectTerminalCapabilities({
    isTTY: false,
    supportsColor: false,
    supportsUnicode: false,
    env: {
      REPOSHERLOCK_NO_ANIM: "1",
    },
  });
  const theme = createTheme(caps);
  const scheduler = new AnimationScheduler({
    reducedMotion: true,
    sleep: async () => {},
  });

  const panel = new ThinkingPanel(renderer as never, scheduler, caps, theme);
  panel.start(["Step one", "Step two", "Step three"]);
  panel.activate(0);
  await panel.complete(0);
  panel.activate(1);
  await panel.complete(1);
  panel.activate(2);
  await panel.complete(2);
  await panel.stop({ finalize: true });

  assert.equal(sections.length, 0);
  const staticOutput = lines.join("\n");
  assert.ok(staticOutput.includes("Sherlock Thinking"));
  assert.equal(lines.filter((line) => line.includes("Step one")).length, 1);
  assert.equal(lines.filter((line) => line.includes("Step two")).length, 1);
  assert.equal(lines.filter((line) => line.includes("Step three")).length, 1);
});

test("ThinkingPanel finalizes once in animated mode without extra static console lines", async () => {
  const sections: string[] = [];
  const lines: string[] = [];
  const liveBlocks: string[] = [];
  let doneCalls = 0;
  let clearCalls = 0;

  const renderer = {
    section: (value: string) => {
      sections.push(value);
    },
    line: (value = "") => {
      lines.push(value);
    },
    lines: (value: string) => {
      lines.push(value);
    },
    liveUpdate: (value: string) => {
      liveBlocks.push(value);
    },
    liveClear: () => {
      clearCalls += 1;
    },
    liveDone: () => {
      doneCalls += 1;
    },
  };

  const caps = {
    isTTY: true,
    supportsUnicode: true,
    supportsColor: false,
    noColor: false,
    quiet: false,
    reducedMotion: false,
    animations: true,
    theme: "mono" as const,
  };
  const theme = createTheme(caps);
  const scheduler = new AnimationScheduler({
    reducedMotion: true,
    sleep: async () => {},
  });

  const panel = new ThinkingPanel(renderer as never, scheduler, caps, theme);
  panel.start(["Step one", "Step two", "Step three"]);
  panel.activate(0);
  await panel.complete(0);
  panel.activate(1);
  await panel.complete(1);
  panel.activate(2);
  await panel.complete(2);
  await panel.stop({ finalize: true });
  await panel.stop({ finalize: true });

  assert.equal(sections.length, 0);
  // Animated mode keeps the final panel via liveUpdate/liveDone and does not re-print static summary lines.
  const staticOutput = lines.join("\n");
  assert.equal(staticOutput.includes("Sherlock Thinking"), false);
  assert.equal(staticOutput.includes("Step one"), false);
  assert.equal(staticOutput.includes("Step two"), false);
  assert.equal(staticOutput.includes("Step three"), false);
  assert.equal(clearCalls, 0);
  assert.equal(doneCalls, 1);
  assert.ok(liveBlocks.length > 0);
  const finalLive = liveBlocks[liveBlocks.length - 1] || "";
  assert.equal((finalLive.match(/Sherlock Thinking/g) || []).length, 1);
  assert.ok(finalLive.includes("Step one"));
  assert.ok(finalLive.includes("Step two"));
  assert.ok(finalLive.includes("Step three"));
});
