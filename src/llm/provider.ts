import type { LlmConfig, LlmProviderType } from "../types.js";

export interface LlmMessage {
  role: "system" | "user";
  content: string;
}

export interface LlmProvider {
  complete(messages: LlmMessage[]): Promise<string>;
}

export const SUPPORTED_LLM_PROVIDERS: LlmProviderType[] = [
  "openai",
  "gemini",
  "anthropic",
  "grok",
  "ollama",
  "openai-compatible",
];

interface ProviderPreset {
  provider: LlmProviderType;
  model: string;
  baseUrl: string;
  apiKeyEnvKeys: string[];
  requiresApiKey: boolean;
  transport: "openai" | "anthropic";
}

export interface ProviderModelOption {
  id: string;
  label: string;
  qualityTier: "max" | "balanced" | "fast";
  recommended?: boolean;
}

const PROVIDER_PRESETS: Record<LlmProviderType, ProviderPreset> = {
  openai: {
    provider: "openai",
    model: "gpt-5.2",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnvKeys: ["LLM_API_KEY", "OPENAI_API_KEY"],
    requiresApiKey: true,
    transport: "openai",
  },
  gemini: {
    provider: "gemini",
    model: "gemini-2.5-pro",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKeyEnvKeys: ["LLM_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"],
    requiresApiKey: true,
    transport: "openai",
  },
  anthropic: {
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    baseUrl: "https://api.anthropic.com/v1",
    apiKeyEnvKeys: ["LLM_API_KEY", "ANTHROPIC_API_KEY"],
    requiresApiKey: true,
    transport: "anthropic",
  },
  grok: {
    provider: "grok",
    model: "grok-4",
    baseUrl: "https://api.x.ai/v1",
    apiKeyEnvKeys: ["LLM_API_KEY", "XAI_API_KEY"],
    requiresApiKey: true,
    transport: "openai",
  },
  ollama: {
    provider: "ollama",
    model: "llama3.2",
    baseUrl: "http://localhost:11434/v1",
    apiKeyEnvKeys: ["LLM_API_KEY", "OLLAMA_API_KEY"],
    requiresApiKey: false,
    transport: "openai",
  },
  "openai-compatible": {
    provider: "openai-compatible",
    model: "gpt-5.2",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnvKeys: ["LLM_API_KEY"],
    requiresApiKey: true,
    transport: "openai",
  },
};

const PROVIDER_MODEL_OPTIONS: Record<LlmProviderType, ProviderModelOption[]> = {
  openai: [
    { id: "gpt-5.2", label: "GPT-5.2", qualityTier: "max", recommended: true },
    { id: "gpt-5", label: "GPT-5", qualityTier: "max" },
    { id: "gpt-5-mini", label: "GPT-5 mini", qualityTier: "balanced" },
    { id: "gpt-5-nano", label: "GPT-5 nano", qualityTier: "fast" },
    { id: "gpt-4.1", label: "GPT-4.1", qualityTier: "balanced" },
  ],
  gemini: [
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", qualityTier: "max", recommended: true },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", qualityTier: "balanced" },
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", qualityTier: "fast" },
  ],
  anthropic: [
    { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", qualityTier: "max", recommended: true },
    { id: "claude-opus-4-5", label: "Claude Opus 4.5", qualityTier: "max" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", qualityTier: "fast" },
  ],
  grok: [
    { id: "grok-4", label: "Grok 4", qualityTier: "max", recommended: true },
    { id: "grok-4-0709", label: "Grok 4-0709", qualityTier: "max" },
    { id: "grok-4-fast-reasoning", label: "Grok 4 Fast Reasoning", qualityTier: "balanced" },
    { id: "grok-code-fast-1", label: "Grok Code Fast 1", qualityTier: "fast" },
  ],
  ollama: [
    { id: "llama3.2", label: "Llama 3.2", qualityTier: "balanced", recommended: true },
    { id: "qwen2.5-coder", label: "Qwen 2.5 Coder", qualityTier: "balanced" },
    { id: "mistral-small3.1", label: "Mistral Small 3.1", qualityTier: "fast" },
  ],
  "openai-compatible": [
    { id: "gpt-5.2", label: "GPT-5.2", qualityTier: "max", recommended: true },
    { id: "gpt-5-mini", label: "GPT-5 mini", qualityTier: "balanced" },
    { id: "gpt-4.1", label: "GPT-4.1", qualityTier: "balanced" },
  ],
};

export const PROVIDER_OFFICIAL_SOURCES: Record<LlmProviderType, string> = {
  openai: "https://platform.openai.com/docs/models",
  gemini: "https://ai.google.dev/gemini-api/docs/models",
  anthropic: "https://docs.anthropic.com/en/docs/about-claude/models/all-models",
  grok: "https://docs.x.ai/docs/models",
  ollama: "https://github.com/ollama/ollama",
  "openai-compatible": "https://platform.openai.com/docs/models",
};

export function getProviderPreset(provider: LlmProviderType): ProviderPreset {
  return PROVIDER_PRESETS[provider];
}

export function getProviderModelOptions(provider: LlmProviderType): ProviderModelOption[] {
  return PROVIDER_MODEL_OPTIONS[provider] || [];
}

export function getRecommendedModel(provider: LlmProviderType): string {
  const options = getProviderModelOptions(provider);
  const recommended = options.find((option) => option.recommended);
  if (recommended) return recommended.id;
  return getProviderPreset(provider).model;
}

export function providerRequiresApiKey(provider: LlmProviderType): boolean {
  return PROVIDER_PRESETS[provider].requiresApiKey;
}

export function resolveProviderApiKey(provider: LlmProviderType): string | undefined {
  const preset = PROVIDER_PRESETS[provider];
  for (const key of preset.apiKeyEnvKeys) {
    const value = process.env[key];
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

export class OpenAiCompatibleProvider implements LlmProvider {
  private config: LlmConfig;

  constructor(config: LlmConfig) {
    this.config = config;
  }

  async complete(messages: LlmMessage[]): Promise<string> {
    if (providerRequiresApiKey(this.config.provider) && !this.config.apiKey) {
      throw new Error("API key is missing for selected LLM provider.");
    }

    const endpoint = `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.config.model,
        temperature: 0.2,
        messages,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const parsed = parseErrorPayload(body);
      const code = parsed?.code || parsed?.type;
      const detail = parsed?.message || body || "unknown error";
      throw new Error(
        `LLM request failed (${response.status}${code ? ` ${code}` : ""}): ${detail.slice(0, 400)}`,
      );
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("LLM response did not include message content.");
    }

    return content;
  }
}

export class AnthropicProvider implements LlmProvider {
  private config: LlmConfig;

  constructor(config: LlmConfig) {
    this.config = config;
  }

  async complete(messages: LlmMessage[]): Promise<string> {
    if (!this.config.apiKey) {
      throw new Error("ANTHROPIC_API_KEY (or LLM_API_KEY) is missing for Anthropic provider.");
    }

    const endpoint = `${this.config.baseUrl.replace(/\/$/, "")}/messages`;
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n")
      .trim();

    const userContent = messages
      .filter((m) => m.role !== "system")
      .map((m) => m.content)
      .join("\n\n")
      .trim();

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: 2000,
        temperature: 0.2,
        ...(system ? { system } : {}),
        messages: [
          {
            role: "user",
            content: userContent || "Please follow the latest instructions.",
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const parsed = parseErrorPayload(body);
      const code = parsed?.code || parsed?.type;
      const detail = parsed?.message || body || "unknown error";
      throw new Error(
        `LLM request failed (${response.status}${code ? ` ${code}` : ""}): ${detail.slice(0, 400)}`,
      );
    }

    const json = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };

    const text = (json.content || [])
      .filter((chunk) => chunk.type === "text" && chunk.text)
      .map((chunk) => chunk.text || "")
      .join("\n")
      .trim();

    if (!text) {
      throw new Error("LLM response did not include text content.");
    }

    return text;
  }
}

export function createLlmProvider(config: LlmConfig): LlmProvider {
  const preset = getProviderPreset(config.provider);
  if (preset.transport === "anthropic") {
    return new AnthropicProvider(config);
  }
  return new OpenAiCompatibleProvider(config);
}

export function resolveLlmConfig(input: {
  provider?: LlmProviderType;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  maxChars: number;
  perFileChars: number;
}): LlmConfig {
  const provider = resolveProvider(input.provider);
  const preset = getProviderPreset(provider);
  const envBaseUrl = provider === "openai-compatible" ? process.env.LLM_BASE_URL : undefined;
  return {
    provider,
    model: input.model || process.env.LLM_MODEL || getRecommendedModel(provider),
    baseUrl: input.baseUrl || envBaseUrl || preset.baseUrl,
    apiKey: input.apiKey || resolveProviderApiKey(provider),
    maxChars: input.maxChars,
    perFileChars: input.perFileChars,
  };
}

function resolveProvider(explicit?: LlmProviderType): LlmProviderType {
  if (explicit) return explicit;
  const envProvider = process.env.LLM_PROVIDER;
  if (envProvider && SUPPORTED_LLM_PROVIDERS.includes(envProvider as LlmProviderType)) {
    return envProvider as LlmProviderType;
  }
  return "openai";
}

function parseErrorPayload(body: string): { message?: string; type?: string; code?: string } | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; type?: string; code?: string };
      message?: string;
      type?: string;
      code?: string;
    };
    if (parsed.error) {
      return {
        message: parsed.error.message,
        type: parsed.error.type,
        code: parsed.error.code,
      };
    }
    return {
      message: parsed.message,
      type: parsed.type,
      code: parsed.code,
    };
  } catch {
    return null;
  }
}
