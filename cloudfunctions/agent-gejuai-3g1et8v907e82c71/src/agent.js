import { createAgent as createLangchainAgent, createMiddleware } from "langchain";
import { MemorySaver } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { getSafeModelConfigSummary, resolveModelRuntimeConfig } from "./model-config.js";

// MemorySaver: 内存级对话历史存储，支持多轮对话上下文
// 生产环境可替换为持久化存储（如数据库）
const checkpointer = new MemorySaver();

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function pickTextFromContent(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part) return "";
        if (typeof part === "string") return part;
        if (typeof part.text === "string") return part.text;
        if (typeof part.content === "string") return part.content;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    if (typeof content.content === "string") return content.content;
  }
  return "";
}

function getMessageRole(message) {
  if (!message || typeof message !== "object") return "";
  if (typeof message.role === "string") return message.role.toLowerCase();
  if (typeof message.type === "string") return message.type.toLowerCase();
  if (typeof message.getType === "function") {
    try {
      return String(message.getType() || "").toLowerCase();
    } catch (_) {}
  }
  return "";
}

function getMessageText(message) {
  if (!message) return "";
  if (typeof message === "string") return message;
  if (typeof message.content === "string") return message.content;
  if (message.content !== undefined) return pickTextFromContent(message.content);
  if (typeof message.text === "string") return message.text;
  return "";
}

function findLatestUserText(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const msg = list[i];
    const role = getMessageRole(msg);
    if (role.includes("user") || role.includes("human")) {
      const text = getMessageText(msg);
      if (text) return text;
    }
  }

  const fallback = list[list.length - 1];
  return getMessageText(fallback);
}

function extractJsonObjectFromText(text, anchorRegex) {
  const source = typeof text === "string" ? text : "";
  if (!source) return null;

  let start = -1;
  if (anchorRegex) {
    const match = source.match(anchorRegex);
    if (match && typeof match.index === "number") {
      start = source.indexOf("{", match.index);
    }
  }

  if (start < 0) start = source.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;

  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (end < 0) return null;
  const jsonText = source.slice(start, end + 1);
  try {
    return JSON.parse(jsonText);
  } catch (_) {
    return null;
  }
}

function parseUserMatchDataFromUserText(userText) {
  const text = typeof userText === "string" ? userText : "";
  if (!text) return null;

  const withAnchor = extractJsonObjectFromText(
    text,
    /userMatchData(?:（JSON）|\(JSON\)|)\s*:/i,
  );
  if (withAnchor && typeof withAnchor === "object") return withAnchor;

  const fallback = extractJsonObjectFromText(text);
  if (!fallback || typeof fallback !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(fallback, "currentUser")
    || Object.prototype.hasOwnProperty.call(fallback, "handFacts")
    || Object.prototype.hasOwnProperty.call(fallback, "matchStatus")) {
    return fallback;
  }
  return null;
}

function buildLangchainPolicyFromUserMatchData(data) {
  const userData = data && typeof data === "object" ? data : {};
  const currentUser = userData.currentUser && typeof userData.currentUser === "object"
    ? userData.currentUser
    : {};
  const totals = userData.totals && typeof userData.totals === "object"
    ? userData.totals
    : {};
  const qualityHint = userData.qualityHint && typeof userData.qualityHint === "object"
    ? userData.qualityHint
    : {};

  const inMatch = !!currentUser.inMatch;
  const isEnded = !!userData.isEnded;
  const aliasPlayerIds = Array.isArray(currentUser.aliasPlayerIds)
    ? currentUser.aliasPlayerIds.filter((x) => typeof x === "string" && x.trim())
    : [];
  const userHands = safeNumber(totals.userHands);
  const totalHands = safeNumber(totals.hands);
  const baseHands = safeNumber(
    qualityHint.baseHands,
    inMatch ? userHands : totalHands,
  );
  const sampleTooSmall = typeof qualityHint.sampleTooSmall === "boolean"
    ? qualityHint.sampleTooSmall
    : baseHands < 20;

  const statusLine = isEnded
    ? "对局状态判断：已结束（status='已结束'）。"
    : "对局状态判断：未结束（可能是记录中/已暂停）。";
  const inMatchLine = inMatch
    ? `当前用户在局中：是（本局绑定马甲数量=${aliasPlayerIds.length}，IDs=${aliasPlayerIds.join(",")}）。`
    : "当前用户在局中：否（本局没有绑定到当前用户的马甲）。";
  const sampleLine = sampleTooSmall
    ? `样本提示：有效样本 ${baseHands} 手，少于20手，必须提示“样本偏小，结论置信度有限”。`
    : `样本提示：有效样本 ${baseHands} 手，可正常给出结论。`;

  return [
    "【LangChain执行策略（系统注入，必须遵守）】",
    "你必须先按以下逻辑推理，再输出结论：",
    `1) ${inMatchLine}`,
    `2) ${statusLine}`,
    `3) ${sampleLine}`,
    "4) 数据使用优先级：先用 userMatchData.handFacts.userHands（若在局中）与 userMatchData.handFacts.showdownHands，再结合 playerStats。",
    "5) 如果当前用户不在局中：跳过“当前用户个人手牌”分析，只做对局层分析。",
    isEnded
      ? "6) 已结束分支：给出提升建议（翻前/翻后/资金管理各1条）+ 对局历程总结（含筹码变化）+ 5手关键手牌复盘点。"
      : "6) 未结束分支：给出通用可执行建议（翻前/翻后/资金管理各1条）+ 对每位玩家实时剥削策略。",
    "7) 最后一行必须是1句风险提示。",
  ].join("\n");
}

function summarizeUserMatchData(data) {
  const userData = data && typeof data === "object" ? data : {};
  const currentUser = userData.currentUser && typeof userData.currentUser === "object"
    ? userData.currentUser
    : {};
  const totals = userData.totals && typeof userData.totals === "object"
    ? userData.totals
    : {};
  const qualityHint = userData.qualityHint && typeof userData.qualityHint === "object"
    ? userData.qualityHint
    : {};

  return {
    inMatch: !!currentUser.inMatch,
    aliasCount: Array.isArray(currentUser.aliasPlayerIds) ? currentUser.aliasPlayerIds.length : 0,
    isEnded: !!userData.isEnded,
    hands: safeNumber(totals.hands),
    userHands: safeNumber(totals.userHands),
    sampleTooSmall: typeof qualityHint.sampleTooSmall === "boolean" ? qualityHint.sampleTooSmall : undefined,
  };
}

const gejuAnalysisPolicyMiddleware = createMiddleware({
  name: "GejuAnalysisPolicyMiddleware",
  wrapModelCall: (request, handler) => {
    try {
      const userText = findLatestUserText(request.messages);
      const userMatchData = parseUserMatchDataFromUserText(userText);
      if (!userMatchData) return handler(request);

      const policyText = buildLangchainPolicyFromUserMatchData(userMatchData);
      console.log("[geju-agent] langchain policy injected", summarizeUserMatchData(userMatchData));
      const baseSystem = typeof request.systemMessage === "string"
        ? request.systemMessage
        : "";
      const nextSystemMessage = baseSystem
        ? `${baseSystem}\n\n${policyText}`
        : policyText;

      return handler({
        ...request,
        systemMessage: nextSystemMessage,
      });
    } catch (err) {
      console.error("[geju-agent] GejuAnalysisPolicyMiddleware failed", err);
      return handler(request);
    }
  },
});

/**
 * 创建 LangChain Agent 实例
 * 这是底层的 Agent 逻辑，负责：
 * - 与大模型交互
 * - 管理对话历史
 * - 处理工具调用
 */
export function createAgent() {
  const modelConfig = resolveModelRuntimeConfig();
  const modelOptions = {
    model: modelConfig.model,
    apiKey: modelConfig.apiKey,
    maxRetries: modelConfig.maxRetries,
    timeout: modelConfig.timeoutMs,
    useResponsesApi: modelConfig.useResponsesApi,
    configuration: {
      baseURL: modelConfig.baseURL,
    },
  };

  if (typeof modelConfig.temperature === "number") {
    modelOptions.temperature = modelConfig.temperature;
  }
  if (typeof modelConfig.maxTokens === "number" && modelConfig.maxTokens > 0) {
    modelOptions.maxTokens = modelConfig.maxTokens;
  }

  console.log("[geju-agent] model runtime", getSafeModelConfigSummary(modelConfig));

  // 配置 OpenAI 兼容的大模型
  const model = new ChatOpenAI(modelOptions);

  return createLangchainAgent({
    model,
    tools: [],
    checkpointer,
    middleware: [gejuAnalysisPolicyMiddleware],
    systemPrompt:
      "你是德州扑克职业选手，擅长对局分析，精通GTO与剥削策略。你必须用中文输出，并且严格遵守系统注入的执行策略。",
  });
}
