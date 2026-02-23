// src/model-config.js
// 统一维护“基模型可插拔”相关配置（预设 + 环境变量解析）

export const MODEL_PRESETS = Object.freeze({
  glm_4_7: {
    label: "智谱 GLM-4.7",
    model: "glm-4.7",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    apiKeyEnvName: "OPENAI_API_KEY",
    timeoutMs: 20000,
    maxRetries: 1,
    useResponsesApi: false,
  },
  openai_gpt_4o: {
    label: "OpenAI GPT-4o",
    model: "gpt-4o",
    baseURL: "https://api.openai.com/v1",
    apiKeyEnvName: "OPENAI_API_KEY",
    timeoutMs: 20000,
    maxRetries: 1,
    useResponsesApi: false,
  },
});

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readIntEnv(name, fallback) {
  const value = normalizeText(process.env[name]);
  if (!value) return fallback;
  const num = Number.parseInt(value, 10);
  return Number.isFinite(num) ? num : fallback;
}

function readFloatEnv(name, fallback) {
  const value = normalizeText(process.env[name]);
  if (!value) return fallback;
  const num = Number.parseFloat(value);
  return Number.isFinite(num) ? num : fallback;
}

function readBooleanEnv(name, fallback) {
  const value = normalizeText(process.env[name]).toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

export function resolveModelRuntimeConfig() {
  const requestedPresetId = normalizeText(process.env.MODEL_PRESET);
  const hasCustomEnv = !!(
    normalizeText(process.env.OPENAI_MODEL)
    || normalizeText(process.env.OPENAI_BASE_URL)
  );

  const autoPresetId = requestedPresetId || (hasCustomEnv ? "custom" : "glm_4_7");
  const preset = MODEL_PRESETS[autoPresetId] || null;
  const effectivePresetId = preset ? autoPresetId : "custom";

  const model = normalizeText(process.env.OPENAI_MODEL) || (preset ? preset.model : "");
  const baseURL = normalizeText(process.env.OPENAI_BASE_URL) || (preset ? preset.baseURL : "");
  const apiKeyEnvName = normalizeText(process.env.MODEL_API_KEY_ENV)
    || (preset ? preset.apiKeyEnvName : "OPENAI_API_KEY");
  const apiKey = normalizeText(process.env[apiKeyEnvName]);

  const timeoutMs = readIntEnv("OPENAI_TIMEOUT_MS", preset ? preset.timeoutMs : 20000);
  const maxRetries = readIntEnv("OPENAI_MAX_RETRIES", preset ? preset.maxRetries : 1);
  const useResponsesApi = readBooleanEnv(
    "OPENAI_USE_RESPONSES_API",
    preset ? preset.useResponsesApi : false,
  );

  const temperatureRaw = normalizeText(process.env.OPENAI_TEMPERATURE);
  const maxTokensRaw = normalizeText(process.env.OPENAI_MAX_TOKENS);

  return {
    requestedPresetId: requestedPresetId || "",
    effectivePresetId,
    model,
    baseURL,
    apiKey,
    apiKeyEnvName,
    timeoutMs,
    maxRetries,
    useResponsesApi,
    temperature: temperatureRaw ? readFloatEnv("OPENAI_TEMPERATURE", undefined) : undefined,
    maxTokens: maxTokensRaw ? readIntEnv("OPENAI_MAX_TOKENS", undefined) : undefined,
  };
}

export function getMissingModelConfig(modelConfig) {
  const config = modelConfig || resolveModelRuntimeConfig();
  const missing = [];

  if (!config.model) {
    missing.push("OPENAI_MODEL");
  }
  if (!config.baseURL) {
    missing.push("OPENAI_BASE_URL");
  }
  if (!config.apiKey) {
    missing.push(config.apiKeyEnvName || "OPENAI_API_KEY");
  }

  return missing;
}

export function getSafeModelConfigSummary(modelConfig) {
  const config = modelConfig || resolveModelRuntimeConfig();
  return {
    requestedPresetId: config.requestedPresetId,
    effectivePresetId: config.effectivePresetId,
    model: config.model,
    baseURL: config.baseURL,
    apiKeyEnvName: config.apiKeyEnvName,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    useResponsesApi: config.useResponsesApi,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
  };
}

export function listAvailableModelPresets() {
  return Object.keys(MODEL_PRESETS);
}
