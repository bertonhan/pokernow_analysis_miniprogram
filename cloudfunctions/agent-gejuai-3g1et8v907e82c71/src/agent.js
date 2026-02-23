import { createAgent as createLangchainAgent } from "langchain";
import { MemorySaver } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { getSafeModelConfigSummary, resolveModelRuntimeConfig } from "./model-config.js";

// MemorySaver: 内存级对话历史存储，支持多轮对话上下文
// 生产环境可替换为持久化存储（如数据库）
const checkpointer = new MemorySaver();

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
    checkpointer,
    // 先关闭 clientTools，减少适配层干扰，优先打通基础问答链路
    middleware: [],
    systemPrompt:
      "你是德州扑克职业选手，擅长对局分析，精通各种德州扑克策略，比如GTO、剥削等等。你必须用中文回复",
  });
}
