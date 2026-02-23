import { createExpressRoutes } from "@cloudbase/agent-server";
import { LangchainAgent } from "@cloudbase/agent-adapter-langchain";
import { createAgent as createLangchainAgent } from "./agent.js";
import express from "express";
import cors from "cors";
import pino from "pino";
import { v4 as uuidv4 } from "uuid";
import { checkOpenAIEnvMiddleware, parseJwtFromRequest } from "./utils.js";

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

console.log("[geju-agent] boot version=2026-02-23-r4")

process.on("unhandledRejection", (reason, promise) => {
  logger.error({ err: reason, promise }, "Unhandled promise rejection caught");
  console.error("[geju-agent] unhandledRejection", reason)
});

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
  console.log("[geju-agent] createAgent start", { requestId })

  let lcAgent
  try {
    lcAgent = createLangchainAgent()
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
        const messages = Array.isArray(input.messages) ? input.messages : []
        const roles = messages.map((m) => m.role)
        const lastUser = messages.filter((m) => m.role === "user").pop()
        const lastUserPreview = typeof (lastUser && lastUser.content) === "string"
          ? lastUser.content.slice(0, 120)
          : "[no user text]"

        runtimeLogger.info(
          {
            requestId,
            threadId: input.threadId || "",
            runId: input.runId || "",
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
          threadId: input.threadId || "",
          runId: input.runId || "",
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

        return next.run(input)
      })
      .use((input, next) => {
        // 使用 AG-UI TypeScript SDK 的 middleware 机制
        // 确保每个请求都有 threadId，用于会话追踪
        // 如果客户端未提供 threadId，则自动生成一个 UUID
        return next.run(
          typeof input.threadId === "string"
            ? input
            : { ...input, threadId: uuidv4() },
        )
      })
      .use((input, next) => {
        // 将请求上下文注入到 Agent 状态中，供后续处理使用
        // - user: 从 Authorization header 解析 JWT 获取用户信息
        //         包含 id (sub)、exp、iat 等 JWT 标准字段
        //         如果未携带有效 JWT 则为 null
        // - req: 原始 Web Request 对象，可用于获取其他请求信息
        return next.run({
          ...input,
          state: {
            ...(input.state || {}),
            __request_context__: {
              user: parseJwtFromRequest(request),
              req: request,
            },
          },
        })
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
