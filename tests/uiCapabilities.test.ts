import test from "node:test";
import assert from "node:assert/strict";
import { detectTerminalCapabilities } from "../src/ui/capabilities.js";

test("detectTerminalCapabilities ignores REPOSHERLOCK_NO_ANIM env toggle", () => {
  const caps = detectTerminalCapabilities({
    isTTY: true,
    supportsColor: true,
    supportsUnicode: true,
    env: {
      REPOSHERLOCK_NO_ANIM: "1",
    },
  });

  assert.equal(caps.reducedMotion, false);
  assert.equal(caps.animations, true);
});

test("detectTerminalCapabilities ignores NO_COLOR for cinematic defaults", () => {
  const caps = detectTerminalCapabilities({
    isTTY: true,
    supportsColor: true,
    supportsUnicode: true,
    env: {
      NO_COLOR: "1",
      REPOSHERLOCK_THEME: "neon",
    },
  });

  assert.equal(caps.noColor, false);
  assert.equal(caps.reducedMotion, false);
  assert.equal(caps.theme, "neon");
});

test("detectTerminalCapabilities ignores REPOSHERLOCK_QUIET env toggle", () => {
  const caps = detectTerminalCapabilities({
    isTTY: true,
    supportsColor: true,
    supportsUnicode: true,
    env: {
      REPOSHERLOCK_QUIET: "1",
      REPOSHERLOCK_THEME: "mono",
    },
  });

  assert.equal(caps.quiet, false);
  assert.equal(caps.animations, true);
  assert.equal(caps.theme, "mono");
});

test("detectTerminalCapabilities disables animations only when not a TTY", () => {
  const caps = detectTerminalCapabilities({
    isTTY: false,
    supportsColor: false,
    supportsUnicode: true,
    env: {},
  });

  assert.equal(caps.animations, false);
  assert.equal(caps.reducedMotion, true);
});
