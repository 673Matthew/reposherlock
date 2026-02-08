import test from "node:test";
import assert from "node:assert/strict";
import { resolveLlmConfig } from "../src/llm/provider.js";

test("resolveLlmConfig uses provider presets and provider-specific key envs", () => {
  const prev = {
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    LLM_MODEL: process.env.LLM_MODEL,
    LLM_BASE_URL: process.env.LLM_BASE_URL,
    LLM_API_KEY: process.env.LLM_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  };

  try {
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    process.env.GEMINI_API_KEY = "gemini-test-key";

    const cfg = resolveLlmConfig({
      provider: "gemini",
      maxChars: 80_000,
      perFileChars: 12_000,
    });

    assert.equal(cfg.provider, "gemini");
    assert.equal(cfg.baseUrl, "https://generativelanguage.googleapis.com/v1beta/openai");
    assert.equal(cfg.model, "gemini-2.5-pro");
    assert.equal(cfg.apiKey, "gemini-test-key");
  } finally {
    restoreEnv("LLM_PROVIDER", prev.LLM_PROVIDER);
    restoreEnv("LLM_MODEL", prev.LLM_MODEL);
    restoreEnv("LLM_BASE_URL", prev.LLM_BASE_URL);
    restoreEnv("LLM_API_KEY", prev.LLM_API_KEY);
    restoreEnv("GEMINI_API_KEY", prev.GEMINI_API_KEY);
  }
});

test("resolveLlmConfig picks anthropic defaults and key", () => {
  const prev = {
    LLM_API_KEY: process.env.LLM_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    LLM_MODEL: process.env.LLM_MODEL,
    LLM_BASE_URL: process.env.LLM_BASE_URL,
  };

  try {
    delete process.env.LLM_API_KEY;
    process.env.ANTHROPIC_API_KEY = "anthropic-test-key";
    delete process.env.LLM_MODEL;
    delete process.env.LLM_BASE_URL;

    const cfg = resolveLlmConfig({
      provider: "anthropic",
      maxChars: 80_000,
      perFileChars: 12_000,
    });

    assert.equal(cfg.provider, "anthropic");
    assert.equal(cfg.model, "claude-sonnet-4-5");
    assert.equal(cfg.baseUrl, "https://api.anthropic.com/v1");
    assert.equal(cfg.apiKey, "anthropic-test-key");
  } finally {
    restoreEnv("LLM_API_KEY", prev.LLM_API_KEY);
    restoreEnv("ANTHROPIC_API_KEY", prev.ANTHROPIC_API_KEY);
    restoreEnv("LLM_MODEL", prev.LLM_MODEL);
    restoreEnv("LLM_BASE_URL", prev.LLM_BASE_URL);
  }
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
