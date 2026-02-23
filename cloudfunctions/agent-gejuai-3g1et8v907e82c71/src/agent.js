import { createAgent as createLangchainAgent } from "langchain";
import { MemorySaver } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";

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
  const modelName = process.env.OPENAI_MODEL
  const apiKey = process.env.OPENAI_API_KEY
  const baseURL = process.env.OPENAI_BASE_URL

  // 配置 OpenAI 兼容的大模型
  const model = new ChatOpenAI({
    model: modelName,
    apiKey,
    maxRetries: 1,
    timeout: 20000,
    // 智谱 OpenAI 兼容接口走 chat/completions，避免误走 responses 接口
    useResponsesApi: false,
    configuration: {
      baseURL,
    },
  });

  return createLangchainAgent({
    model,
    checkpointer,
    // 先关闭 clientTools，减少适配层干扰，优先打通基础问答链路
    middleware: [],
    systemPrompt:
      "你是德州扑克职业选手，擅长对局分析，精通各种德州扑克策略，比如GTO、剥削等等。",
  });
}
