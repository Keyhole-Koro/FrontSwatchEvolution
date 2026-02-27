import fs from "fs";
import path from "path";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

type Provider = "mock" | "gemini" | "nova";

type GeminiConfig = {
  model: string;
  apiKeyEnv?: string;
  apiKey?: string;
};

type NovaConfig = {
  modelId: string;
  awsRegion: string;
  accessKeyIdEnv?: string;
  secretAccessKeyEnv?: string;
  sessionTokenEnv?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
};

type LlmConfig = {
  provider?: Provider;
  gemini: GeminiConfig;
  nova: NovaConfig;
};

type CompleteJsonInput<T> = {
  instruction: string;
  input: unknown;
  fallback: T;
};

const CONFIG_PATH = path.resolve(__dirname, "../config/llm-config.json");
let cachedConfig: LlmConfig | null = null;

function requireString(value: unknown, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required config: ${label}`);
  }
}

function resolveSecret(rawValue: unknown, envKey: unknown, label: string): string {
  if (typeof envKey === "string" && envKey.trim().length > 0) {
    const value = process.env[envKey];
    if (!value || value.trim().length === 0) {
      throw new Error(`Missing required environment secret: ${envKey} for ${label}`);
    }
    return value;
  }

  if (typeof rawValue === "string" && rawValue.trim().length > 0) {
    return rawValue;
  }
  throw new Error(`Missing secret config for ${label}`);
}

function resolveSecretOptional(rawValue: unknown, envKey: unknown): string {
  if (typeof envKey === "string" && envKey.trim().length > 0) {
    return process.env[envKey] || "";
  }
  return typeof rawValue === "string" ? rawValue : "";
}

export function loadLlmConfig(): LlmConfig {
  if (cachedConfig) return cachedConfig;
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Missing config file: ${CONFIG_PATH}`);
  }

  const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  const parsed = JSON.parse(raw) as Partial<LlmConfig>;

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid llm-config.json: root object is required");
  }

  if (!parsed.gemini || typeof parsed.gemini !== "object") {
    throw new Error("Invalid llm-config.json: gemini object is required");
  }
  if (!parsed.nova || typeof parsed.nova !== "object") {
    throw new Error("Invalid llm-config.json: nova object is required");
  }

  requireString(parsed.gemini.model, "gemini.model");
  requireString(parsed.nova.modelId, "nova.modelId");
  requireString(parsed.nova.awsRegion, "nova.awsRegion");

  cachedConfig = parsed as LlmConfig;
  return cachedConfig;
}

function extractJsonObject(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text).match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function formatEnumRules(enums: Record<string, string[]>): string {
  return Object.entries(enums)
    .map(([key, values]) => `${key}: [${values.join(", ")}]`)
    .join("; ");
}

type LlmClientOptions = {
  provider?: Provider;
  geminiApiKey?: string;
  geminiModel?: string;
  novaModelId?: string;
  awsRegion?: string;
};

export class LlmClient {
  provider: Provider;
  config: LlmConfig;
  geminiApiKey: string;
  geminiModel: string;
  novaModelId: string;
  awsRegion: string;
  novaAccessKeyId: string;
  novaSecretAccessKey: string;
  novaSessionToken: string;
  bedrock: BedrockRuntimeClient | null;

  constructor(options: LlmClientOptions = {}) {
    this.config = loadLlmConfig();
    this.provider = (options.provider || this.config.provider || "mock") as Provider;
    this.geminiApiKey =
      options.geminiApiKey ||
      resolveSecretOptional(this.config.gemini.apiKey, this.config.gemini.apiKeyEnv);
    this.geminiModel = options.geminiModel || this.config.gemini.model;
    this.novaModelId = options.novaModelId || this.config.nova.modelId;
    this.awsRegion = options.awsRegion || this.config.nova.awsRegion;
    this.novaAccessKeyId = resolveSecretOptional(
      this.config.nova.accessKeyId,
      this.config.nova.accessKeyIdEnv
    );
    this.novaSecretAccessKey = resolveSecretOptional(
      this.config.nova.secretAccessKey,
      this.config.nova.secretAccessKeyEnv
    );
    this.novaSessionToken =
      (this.config.nova.sessionTokenEnv && process.env[this.config.nova.sessionTokenEnv]) ||
      this.config.nova.sessionToken ||
      "";
    this.bedrock = null;

    if (this.provider === "gemini") {
      this.geminiApiKey =
        options.geminiApiKey ||
        resolveSecret(
          this.config.gemini.apiKey,
          this.config.gemini.apiKeyEnv,
          "gemini.apiKey/apiKeyEnv"
        );
    }

    if (this.provider === "nova") {
      this.novaAccessKeyId = resolveSecret(
        this.config.nova.accessKeyId,
        this.config.nova.accessKeyIdEnv,
        "nova.accessKeyId/accessKeyIdEnv"
      );
      this.novaSecretAccessKey = resolveSecret(
        this.config.nova.secretAccessKey,
        this.config.nova.secretAccessKeyEnv,
        "nova.secretAccessKey/secretAccessKeyEnv"
      );
    }
  }

  getProviderInfo(): Record<string, unknown> {
    return {
      provider: this.provider,
      geminiModel: this.geminiModel,
      novaModelId: this.novaModelId,
      awsRegion: this.awsRegion,
      hasGeminiApiKey: Boolean(this.geminiApiKey),
      secretSource: {
        gemini: this.config.gemini.apiKeyEnv ? `env:${this.config.gemini.apiKeyEnv}` : "inline",
        novaAccessKeyId: this.config.nova.accessKeyIdEnv
          ? `env:${this.config.nova.accessKeyIdEnv}`
          : "inline",
        novaSecretAccessKey: this.config.nova.secretAccessKeyEnv
          ? `env:${this.config.nova.secretAccessKeyEnv}`
          : "inline"
      }
    };
  }

  async completeJson<T>({ instruction, input, fallback }: CompleteJsonInput<T>): Promise<T> {
    const prompt = [
      "Return JSON only. No markdown, no prose.",
      instruction,
      `Input: ${JSON.stringify(input)}`
    ].join("\n");

    if (this.provider === "gemini") {
      const result = await this.callGemini(prompt);
      return (extractJsonObject(result) as T) || fallback;
    }

    if (this.provider === "nova") {
      const result = await this.callNova(prompt);
      return (extractJsonObject(result) as T) || fallback;
    }

    return fallback;
  }

  async scoreAesthetic({
    candidateId,
    genre,
    designDNA
  }: {
    candidateId: string;
    genre?: unknown;
    designDNA: unknown;
  }): Promise<{ score: number; reason: string; riskFlags: string[] }> {
    return this.completeJson({
      instruction:
        'Score aesthetics from 0..1. JSON schema: {"score":number,"reason":"string","riskFlags":["string"]}',
      input: { candidateId, genre, designDNA },
      fallback: { score: 0.75, reason: "fallback", riskFlags: [] }
    });
  }

  async generateParamSets({
    targetUiId,
    baseThemeId,
    count,
    mode,
    focusFamilies,
    enums,
    diversityRules
  }: {
    targetUiId: string;
    baseThemeId: string;
    count: number;
    mode: "exploration" | "exploitation";
    focusFamilies: string[];
    enums: Record<string, string[]>;
    diversityRules: Record<string, number>;
  }): Promise<{ count: number; candidates: unknown[] }> {
    return this.completeJson({
      instruction: [
        "You are generating UI parameter sets.",
        'Return JSON only with schema: {"count":number,"candidates":[{"params":{"vibe":"...","era":"...","densityProfile":"...","elevationProfile":"...","radiusProfile":"...","colorStrategy":"..."}}]}',
        `Output exactly ${count} candidates.`,
        "No prose. No markdown. No extra keys.",
        `Generation mode: ${mode}.`,
        mode === "exploitation" && focusFamilies.length > 0
          ? `Prefer these visual families: ${focusFamilies.join(", ")}`
          : "Prioritize broad visual family spread.",
        "All values must be chosen from enum lists only.",
        "Do not return duplicate params sets.",
        `Diversity rules: ${JSON.stringify(diversityRules)}`,
        `Enums: ${formatEnumRules(enums)}`
      ].join(" "),
      input: { targetUiId, baseThemeId, count, mode, focusFamilies, diversityRules },
      fallback: { count, candidates: [] }
    });
  }

  async repairParamSets({
    targetUiId,
    baseThemeId,
    count,
    mode,
    focusFamilies,
    enums,
    diversityRules,
    previousCandidates,
    violations
  }: {
    targetUiId: string;
    baseThemeId: string;
    count: number;
    mode: "exploration" | "exploitation";
    focusFamilies: string[];
    enums: Record<string, string[]>;
    diversityRules: Record<string, number>;
    previousCandidates: unknown[];
    violations: string[];
  }): Promise<{ count: number; candidates: unknown[] }> {
    return this.completeJson({
      instruction: [
        "Repair the previous JSON output.",
        'Keep response JSON-only with schema: {"count":number,"candidates":[{"params":{...}}]}',
        `Output exactly ${count} candidates after fixing violations.`,
        `Generation mode: ${mode}.`,
        mode === "exploitation" && focusFamilies.length > 0
          ? `Prefer these visual families: ${focusFamilies.join(", ")}`
          : "Keep visual families broadly diverse.",
        "Fix only violations. Preserve as many valid candidates as possible.",
        "All values must be enum values only and no duplicate params sets.",
        `Violations: ${JSON.stringify(violations)}`,
        `Diversity rules: ${JSON.stringify(diversityRules)}`,
        `Enums: ${formatEnumRules(enums)}`
      ].join(" "),
      input: { targetUiId, baseThemeId, count, mode, focusFamilies, previousCandidates },
      fallback: { count, candidates: previousCandidates || [] }
    });
  }

  async callGemini(prompt: string): Promise<string> {
    if (!this.geminiApiKey) {
      throw new Error("GEMINI_API_KEY is required for provider=gemini");
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent?key=${this.geminiApiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 800
        }
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gemini request failed: ${response.status} ${text}`);
    }

    const payload = (await response.json()) as any;
    return payload?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  async callNova(prompt: string): Promise<string> {
    if (!this.bedrock) {
      const credentials = {
        accessKeyId: this.novaAccessKeyId,
        secretAccessKey: this.novaSecretAccessKey,
        sessionToken: this.novaSessionToken || undefined
      };
      this.bedrock = new BedrockRuntimeClient({
        region: this.awsRegion,
        credentials
      });
    }

    const command = new ConverseCommand({
      modelId: this.novaModelId,
      messages: [
        {
          role: "user",
          content: [{ text: prompt }]
        }
      ],
      inferenceConfig: {
        temperature: 0.2,
        maxTokens: 800
      }
    });

    const response = await this.bedrock.send(command);
    return response?.output?.message?.content?.[0]?.text || "";
  }
}
