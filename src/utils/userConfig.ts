import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { LlmProviderType } from "../types.js";
import { ensureDir } from "./fs.js";

export interface UserLlmPreferences {
  defaultProvider: LlmProviderType;
  modelByProvider: Partial<Record<LlmProviderType, string>>;
}

export interface UserLlmCredentials {
  apiKeyByProvider: Partial<Record<LlmProviderType, string>>;
}

const DEFAULT_PREFERENCES: UserLlmPreferences = {
  defaultProvider: "openai",
  modelByProvider: {},
};

const DEFAULT_CREDENTIALS: UserLlmCredentials = {
  apiKeyByProvider: {},
};

function configDir(): string {
  return path.join(os.homedir(), ".reposherlock");
}

function preferencesPath(): string {
  return path.join(configDir(), "preferences.json");
}

function credentialsPath(): string {
  return path.join(configDir(), "credentials.json");
}

export async function loadUserLlmPreferences(): Promise<UserLlmPreferences> {
  const file = preferencesPath();
  const text = await fs.readFile(file, "utf8").catch(() => "");
  if (!text) return { ...DEFAULT_PREFERENCES };

  try {
    const parsed = JSON.parse(text) as Partial<UserLlmPreferences>;
    return {
      defaultProvider: parsed.defaultProvider || "openai",
      modelByProvider: parsed.modelByProvider || {},
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export async function saveUserLlmPreferences(input: UserLlmPreferences): Promise<void> {
  await ensureDir(configDir());
  await fs.writeFile(preferencesPath(), `${JSON.stringify(input, null, 2)}\n`, "utf8");
}

export async function loadUserLlmCredentials(): Promise<UserLlmCredentials> {
  const file = credentialsPath();
  const text = await fs.readFile(file, "utf8").catch(() => "");
  if (!text) return { ...DEFAULT_CREDENTIALS };

  try {
    const parsed = JSON.parse(text) as Partial<UserLlmCredentials>;
    return {
      apiKeyByProvider: parsed.apiKeyByProvider || {},
    };
  } catch {
    return { ...DEFAULT_CREDENTIALS };
  }
}

export async function saveUserLlmCredentials(input: UserLlmCredentials): Promise<void> {
  await ensureDir(configDir());
  const file = credentialsPath();
  await fs.writeFile(file, `${JSON.stringify(input, null, 2)}\n`, "utf8");
  try {
    await fs.chmod(file, 0o600);
  } catch {
    // best effort across platforms
  }
}

export function getStoredApiKeyForProvider(
  creds: UserLlmCredentials,
  provider: LlmProviderType,
): string | undefined {
  const value = creds.apiKeyByProvider[provider];
  if (!value) return undefined;
  return value.trim() || undefined;
}

export async function upsertProviderModelPreference(
  provider: LlmProviderType,
  model: string,
): Promise<void> {
  const prefs = await loadUserLlmPreferences();
  prefs.defaultProvider = provider;
  prefs.modelByProvider[provider] = model;
  await saveUserLlmPreferences(prefs);
}

export async function upsertProviderApiKey(
  provider: LlmProviderType,
  apiKey: string,
): Promise<void> {
  const creds = await loadUserLlmCredentials();
  creds.apiKeyByProvider[provider] = apiKey;
  await saveUserLlmCredentials(creds);
}

