import { createExpressRoutes } from "@cloudbase/agent-server";
import { LangchainAgent } from "@cloudbase/agent-adapter-langchain";
import {
  createAgent as createLangchainAgent,
  parseUserMatchDataFromUserText,
} from "./agent.js";
import express from "express";
import cors from "cors";
import pino from "pino";
import { v4 as uuidv4 } from "uuid";
import { checkOpenAIEnvMiddleware, parseJwtFromRequest } from "./utils.js";
import { getSafeModelConfigSummary, resolveModelRuntimeConfig } from "./model-config.js";
import {
  appendTraceEvent,
  createOrUpdateHistoryStart,
  markHistoryCompleted,
  markHistoryFailed,
} from "./chat-history-store.js";

/**
 * 创建 Logger 实例
 *
 * 可以使用任何符合 Logger 接口的日志库，例如：
 * - pino: pino({ level: "info" })
 * - winston: winston.createLogger()
 * - console: 直接传入 console
 * - 自定义: 只需实现 info/warn/error 等方法
 *
 * Logger 接口定义见: import("@cloudbase/agent-shared").Logger
 */
const logger = pino({
  level: process.env.LOG_LEVEL || "info",
});

console.log("[geju-agent] boot version=2026-02-25-r8")

process.on("unhandledRejection", (reason, promise) => {
  logger.error({ err: reason, promise }, "Unhandled promise rejection caught");
  console.error("[geju-agent] unhandledRejection", reason)
});

function clipText(value, maxLen) {
  const text = typeof value === "string" ? value : "";
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}\n...[truncated]`;
}

function pickTextFromUnknown(value, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => pickTextFromUnknown(item, depth + 1)).filter(Boolean).join("\n");
  }
  if (typeof value !== "object") return "";

  if (typeof value.text === "string") return value.text;
  if (typeof value.content === "string") return value.content;

  if (Array.isArray(value.content)) {
    const text = value.content
      .map((item) => {
        if (!item) return "";
        if (typeof item === "string") return item;
        if (typeof item.text === "string") return item.text;
        if (typeof item.content === "string") return item.content;
        return "";
      })
      .filter(Boolean)
      .join("\n");
    if (text) return text;
  }

  if (Array.isArray(value.messages)) {
    for (let i = value.messages.length - 1; i >= 0; i -= 1) {
      const one = value.messages[i];
      const role = typeof one?.role === "string" ? one.role.toLowerCase() : "";
      if (!role.includes("assistant") && !role.includes("ai")) continue;
      const messageText = pickTextFromUnknown(one, depth + 1);
      if (messageText) return messageText;
    }
  }

  const nestedKeys = [
    "output_text",
    "outputText",
    "response",
    "output",
    "result",
    "message",
    "finalOutput",
    "data",
  ];

  for (const key of nestedKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const nested = pickTextFromUnknown(value[key], depth + 1);
    if (nested) return nested;
  }

  return "";
}

function parseAgentIdFromRequest(request) {
  const rawUrl = typeof request?.url === "string" ? request.url : "";
  if (!rawUrl) return "";

  let pathname = rawUrl;
  try {
    if (/^https?:\/\//i.test(rawUrl)) {
      pathname = new URL(rawUrl).pathname;
    } else {
      pathname = rawUrl.split("?")[0];
    }
  } catch (_) {
    pathname = rawUrl.split("?")[0];
  }

  const match = pathname.match(/\/v1\/aibot\/bots\/([^/]+)\//);
  if (!match || !match[1]) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch (_) {
    return match[1];
  }
}

function normalizeSceneId(inputState) {
  const state = inputState && typeof inputState === "object" ? inputState : {};
  const sceneId = typeof state.__client_scene_id__ === "string" ? state.__client_scene_id__.trim() : "";
  return sceneId;
}

function normalizeError(err) {
  if (!err) return { message: "Unknown error" };
  const message = typeof err.message === "string" ? err.message : String(err);
  const name = typeof err.name === "string" ? err.name : "Error";
  const code = typeof err.code === "string" ? err.code : "";
  const stack = typeof err.stack === "string" ? clipText(err.stack, 4000) : "";
  return { name, code, message, stack };
}

function summarizeStreamContract(value) {
  const isObjLike = value !== null && (typeof value === "object" || typeof value === "function");
  if (!isObjLike) {
    return {
      valueType: typeof value,
      ctor: "",
      hasPipe: false,
      hasThen: false,
      hasSubscribe: false,
      keys: [],
    };
  }

  const ctor = value && value.constructor && value.constructor.name
    ? String(value.constructor.name)
    : "";

  let keys = [];
  try {
    keys = Object.keys(value).slice(0, 8);
  } catch (_) {}

  return {
    valueType: typeof value,
    ctor,
    hasPipe: typeof value.pipe === "function",
    hasThen: typeof value.then === "function",
    hasSubscribe: typeof value.subscribe === "function",
    keys,
  };
}

function logStreamContract(runtimeLogger, requestId, stage, value) {
  const info = summarizeStreamContract(value);
  const payload = {
    requestId,
    stage,
    valueType: info.valueType,
    ctor: info.ctor,
    hasPipe: info.hasPipe,
    hasThen: info.hasThen,
    hasSubscribe: info.hasSubscribe,
    keys: info.keys,
  };

  if (info.hasPipe) {
    if (process.env.GEJU_DEBUG_STREAM === "true") {
      runtimeLogger.info(payload, "Stream contract ok");
    }
    return;
  }

  runtimeLogger.warn(payload, "Stream contract risk: result has no pipe()");
}

async function safePersist(task, runtimeLogger, label, extra = {}) {
  try {
    return await task();
  } catch (err) {
    runtimeLogger.warn({
      ...extra,
      label,
      err: normalizeError(err),
    }, "History persistence failed");
    return null;
  }
}

/**
 * 创建 AG-UI 兼容的 Agent
 *
 * 这里有两层封装：
 * 1. createLangchainAgent() - 底层 LangChain Agent，处理 LLM 对话逻辑
 * 2. LangchainAgent - 适配器，将 LangChain 转换为 AG-UI 协议格式
 *
 * AG-UI 协议: https://docs.cloudbase.net/ai/agent-development/protocol
 *
 * context 包含以下属性：
 * - request: 当前 HTTP 请求（Web Standard Request）
 * - logger: 日志实例（带 requestId 上下文）
 * - requestId: 请求追踪 ID
 *
 * @type {import("@cloudbase/agent-server").AgentCreator}
 */
const createAgent = ({ request, logger: requestLogger, requestId }) => {
  // 可以根据 context 实现按请求动态配置，例如：
  // - 从 request 获取用户信息
  // - 根据不同用户使用不同的模型配置
  // - 使用 logger 记录请求日志
  // - 使用 requestId 追踪请求链路

  const runtimeLogger = requestLogger || logger
  const requestUser = parseJwtFromRequest(request)
  const requestStartedAtMs = Date.now()
  const agentId = parseAgentIdFromRequest(request)
  const modelSummary = getSafeModelConfigSummary(resolveModelRuntimeConfig())
  const traceState = {
    historyId: "",
    threadId: "",
    runId: "",
    sequence: 0,
    traceCount: 0,
    lastEventType: "",
    runStartedAtMs: 0,
    outputText: "",
  }

  const emitTrace = async (eventType, payload, level = "info") => {
    if (!traceState.historyId) return
    traceState.sequence += 1
    traceState.traceCount += 1
    traceState.lastEventType = eventType
    await safePersist(
      () => appendTraceEvent({
        historyId: traceState.historyId,
        agentId,
        requestId,
        threadId: traceState.threadId,
        runId: traceState.runId,
        sequence: traceState.sequence,
        level,
        eventType,
        payload,
      }),
      runtimeLogger,
      "appendTraceEvent",
      { eventType, historyId: traceState.historyId },
    )
  }

  const traceHooks = {
    onTraceEvent: async (eventType, payload) => {
      await emitTrace(eventType, payload || {})
    },
    onModelOutput: async (payload) => {
      const info = payload && typeof payload === "object" ? payload : {}
      const text = typeof info.text === "string" ? info.text : ""
      if (text && text.length > traceState.outputText.length) {
        traceState.outputText = text
      }
      await emitTrace("MODEL_OUTPUT_CAPTURED", {
        hasText: !!text,
        chars: text.length,
      })
    },
  }

  console.log("[geju-agent] createAgent start", { requestId })

  let lcAgent
  try {
    lcAgent = createLangchainAgent({ traceHooks })
    console.log("[geju-agent] createLangchainAgent ok", { requestId })
  } catch (err) {
    console.error("[geju-agent] createLangchainAgent failed", err)
    throw err
  }

  return {
    agent: new LangchainAgent({
      agent: lcAgent,
      logger: runtimeLogger,
    })
      .use((input, next) => {
        // 使用 AG-UI TypeScript SDK 的 middleware 机制
        // 确保每个请求都有 threadId，用于会话追踪
        // 如果客户端未提供 threadId，则自动生成一个 UUID
        const result = next.run(
          typeof input.threadId === "string"
            ? input
            : { ...input, threadId: uuidv4() },
        )
        logStreamContract(runtimeLogger, requestId, "middleware.ensureThreadId", result)
        return result
      })
      .use((input, next) => {
        // 将请求上下文注入到 Agent 状态中，供后续处理使用
        // - user: 从 Authorization header 解析 JWT 获取用户信息
        //         包含 id (sub)、exp、iat 等 JWT 标准字段
        //         如果未携带有效 JWT 则为 null
        // - req: 原始 Web Request 对象，可用于获取其他请求信息
        const result = next.run({
          ...input,
          state: {
            ...(input.state || {}),
            __request_context__: {
              user: requestUser,
              req: request,
            },
          },
        })
        logStreamContract(runtimeLogger, requestId, "middleware.injectRequestContext", result)
        return result
      })
      .use((input, next) => {
        const messages = Array.isArray(input.messages) ? input.messages : []
        const roles = messages.map((m) => m.role)
        const lastUser = messages.filter((m) => m.role === "user").pop()
        const lastUserText = typeof (lastUser && lastUser.content) === "string"
          ? lastUser.content
          : pickTextFromUnknown(lastUser)
        const lastUserPreview = lastUserText ? clipText(lastUserText, 120) : "[no user text]"
        const sceneId = normalizeSceneId(input.state)
        const userMatchData = parseUserMatchDataFromUserText(lastUserText)

        traceState.threadId = input.threadId || ""
        traceState.runId = typeof input.runId === "string" ? input.runId : ""
        traceState.runStartedAtMs = Date.now()

        runtimeLogger.info(
          {
            requestId,
            threadId: traceState.threadId,
            runId: traceState.runId,
            sceneId,
            messageCount: messages.length,
            roles,
            hasUserMessage: !!lastUser,
            lastUserPreview,
          },
          "AGUI input summary"
        )
        console.log("[geju-agent] middleware input summary", {
          requestId,
          messageCount: messages.length,
          roles,
          hasUserMessage: !!lastUser,
          threadId: traceState.threadId,
          runId: traceState.runId,
          sceneId,
        })

        if (!lastUser) {
          runtimeLogger.warn(
            {
              requestId,
              messageCount: messages.length,
              roles,
            },
            "No user message found in AGUI input"
          )
        }

        void (async () => {
          const historyId = await safePersist(
            () => createOrUpdateHistoryStart({
              agentId,
              requestId,
              threadId: traceState.threadId,
              runId: traceState.runId,
              sceneId,
              userId: requestUser && requestUser.id ? String(requestUser.id) : "",
              model: modelSummary,
              messages,
              promptText: lastUserText,
              userMatchData,
              clientState: input.state || {},
            }),
            runtimeLogger,
            "createOrUpdateHistoryStart",
            { requestId, threadId: traceState.threadId, runId: traceState.runId },
          )
          if (historyId) traceState.historyId = historyId

          await emitTrace("REQUEST_RECEIVED", {
            requestId,
            sceneId,
            messageCount: messages.length,
            hasUserMessage: !!lastUser,
            threadId: traceState.threadId,
            runId: traceState.runId,
          })

          await emitTrace("RUN_STARTED", {
            requestId,
            sceneId,
            startedAtMs: traceState.runStartedAtMs,
          })
        })()

        let result
        try {
          result = next.run(input)
          logStreamContract(runtimeLogger, requestId, "middleware.traceAndPersist", result)
        } catch (err) {
          const durationMs = Date.now() - traceState.runStartedAtMs
          const normalizedError = normalizeError(err)
          void (async () => {
            await emitTrace("RUN_ERROR", normalizedError, "error")
            if (traceState.historyId) {
              await safePersist(
                () => markHistoryFailed({
                  historyId: traceState.historyId,
                  durationMs,
                  traceCount: traceState.traceCount,
                  lastEventType: traceState.lastEventType || "RUN_ERROR",
                  error: normalizedError,
                }),
                runtimeLogger,
                "markHistoryFailed",
                { historyId: traceState.historyId, requestId },
              )
            }
          })()
          throw err
        }

        Promise.resolve(result)
          .then((resolved) => {
            const resultText = pickTextFromUnknown(resolved)
            if (resultText && resultText.length > traceState.outputText.length) {
              traceState.outputText = resultText
            }
            const durationMs = Date.now() - traceState.runStartedAtMs
            void (async () => {
              await emitTrace("RUN_FINISHED", {
                durationMs,
                outputChars: traceState.outputText.length,
              })
              if (traceState.historyId) {
                await safePersist(
                  () => markHistoryCompleted({
                    historyId: traceState.historyId,
                    outputText: traceState.outputText,
                    durationMs,
                    traceCount: traceState.traceCount,
                    lastEventType: traceState.lastEventType || "RUN_FINISHED",
                    runMetrics: {
                      requestDurationMs: Date.now() - requestStartedAtMs,
                      runDurationMs: durationMs,
                    },
                  }),
                  runtimeLogger,
                  "markHistoryCompleted",
                  { historyId: traceState.historyId, requestId },
                )
              }
            })()
          })
          .catch((err) => {
            const durationMs = Date.now() - traceState.runStartedAtMs
            const normalizedError = normalizeError(err)
            void (async () => {
              await emitTrace("RUN_ERROR", normalizedError, "error")
              if (traceState.historyId) {
                await safePersist(
                  () => markHistoryFailed({
                    historyId: traceState.historyId,
                    durationMs,
                    traceCount: traceState.traceCount,
                    lastEventType: traceState.lastEventType || "RUN_ERROR",
                    error: normalizedError,
                  }),
                  runtimeLogger,
                  "markHistoryFailed",
                  { historyId: traceState.historyId, requestId },
                )
              }
            })()
          })

        return result
      }),
  };
};

const app = express();

app.use((req, res, next) => {
  const startedAt = Date.now()
  console.log("[geju-agent] express request", {
    method: req.method,
    url: req.originalUrl || req.url || "",
    contentType: req.headers["content-type"] || "",
    contentLength: req.headers["content-length"] || "",
  })

  res.on("finish", () => {
    console.log("[geju-agent] express response", {
      method: req.method,
      url: req.originalUrl || req.url || "",
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    })
  })

  next()
})

// 仅在 ENABLE_CORS=true 时启用 CORS
if (process.env.ENABLE_CORS === "true") {
  app.use(cors());
}

app.use(checkOpenAIEnvMiddleware);

// 注册 AG-UI 协议路由，自动处理 SSE 流式响应、工具调用等
createExpressRoutes({
  createAgent,
  express: app,
  logger,
});

app.listen(9000, () => logger.info("Listening on 9000!"));
