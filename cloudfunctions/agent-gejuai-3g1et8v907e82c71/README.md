# LangChain JavaScript 示例

基于 LangChain JavaScript 的 Agent 示例项目，可部署至腾讯云 CloudBase 作为 HTTP 云函数运行。

> 📚 **参考文档**：[CloudBase AI Agent 开发指南](https://docs.cloudbase.net/ai/agent-development/)

## 功能概述

本项目创建了一个基于 LangChain 的 AI 对话代理服务，具备以下特性：

- 使用 OpenAI 兼容的 LLM 接口
- 支持对话记忆（MemorySaver）
- 通过 Express 提供 HTTP API
- 可部署为 CloudBase HTTP 云函数

## 核心依赖

| 包名 | 说明 |
|------|------|
| [@cloudbase/agent-server](https://www.npmjs.com/package/@cloudbase/agent-server) | CloudBase Agent 服务端，提供 AG-UI 协议路由 |
| [@cloudbase/agent-adapter-langchain](https://www.npmjs.com/package/@cloudbase/agent-adapter-langchain) | LangChain 适配器，将 LangChain Agent 转换为 AG-UI 格式 |
| [@langchain/openai](https://www.npmjs.com/package/@langchain/openai) | LangChain OpenAI 集成 |
| [@langchain/langgraph](https://www.npmjs.com/package/@langchain/langgraph) | LangGraph 状态管理，提供 MemorySaver 等 |
| [langchain](https://www.npmjs.com/package/langchain) | LangChain 核心库 |

## 环境要求

- Node.js >= 20

## 环境变量配置

启动服务前，需要配置以下环境变量：

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `MODEL_PRESET` | ❌ | 预设模型 ID（默认 `glm_4_7`，可在 `src/model-config.js` 查看） |
| `OPENAI_API_KEY` | ✅ | OpenAI API 密钥或兼容服务的 API 密钥 |
| `OPENAI_BASE_URL` | 条件必填 | 自定义模式必填（不用预设时） |
| `OPENAI_MODEL` | 条件必填 | 自定义模式必填（不用预设时） |
| `MODEL_API_KEY_ENV` | ❌ | API Key 变量名（默认 `OPENAI_API_KEY`） |
| `OPENAI_TIMEOUT_MS` | ❌ | 请求超时（毫秒），默认 `20000` |
| `OPENAI_MAX_RETRIES` | ❌ | 重试次数，默认 `1` |
| `OPENAI_TEMPERATURE` | ❌ | 采样温度 |
| `OPENAI_MAX_TOKENS` | ❌ | 单次输出上限 |
| `OPENAI_USE_RESPONSES_API` | ❌ | 是否走 responses API，默认 `false` |
| `LOG_LEVEL` | ❌ | 日志级别，可选值：`trace`/`debug`/`info`/`warn`/`error`/`fatal`，默认 `info` |
| `ENABLE_CORS` | ❌ | 是否启用 CORS，设为 `true` 启用。本地开发跨域调试时可启用，生产环境建议通过网关配置 |

复制 `.env.example` 并重命名为 `.env`，填入实际值：

```bash
cp .env.example .env
```

## 模型切换（即插即用）

模型相关配置已集中在：

- `src/model-config.js`

切换方式：

1. 预设模式（推荐）：只改 `MODEL_PRESET`。  
2. 自定义模式：填写 `OPENAI_BASE_URL + OPENAI_MODEL`。  

部署后可在日志里查看 `"[geju-agent] model runtime"`，确认实际生效模型。

## 安装依赖

```bash
npm i
```

## 启动服务

```bash
node src/index.js
```

服务启动后监听 `http://localhost:9000`。

## API 调用

本项目基于 AG-UI 协议提供 API，支持 SSE 流式传输。

### 本地调用

```bash
curl 'http://localhost:9000/send-message' \
  -H 'Accept: text/event-stream' \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "threadId": "thread-001",
    "runId": "run-001",
    "messages": [
      { "id": "msg-1", "role": "user", "content": "你好" }
    ],
    "tools": [],
    "context": [],
    "state": {}
  }'
```

### 部署后调用

部署到 CloudBase 后，接口地址为 `https://{envId}.api.tcloudbasegateway.com/v1/aibot/bots/{agentId}/send-message`，需携带 API Key：

```bash
curl 'https://{envId}.api.tcloudbasegateway.com/v1/aibot/bots/{agentId}/send-message' \
  -H 'Authorization: Bearer <YOUR_API_KEY>' \
  -H 'Accept: text/event-stream' \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "threadId": "thread-001",
    "runId": "run-001",
    "messages": [
      { "id": "msg-1", "role": "user", "content": "你好" }
    ],
    "tools": [],
    "context": [],
    "state": {}
  }'
```

更多调用方式请参考官方文档：[cURL 调用](https://docs.cloudbase.net/ai/agent-development/integration/curl)

## 项目结构

```
├── src/
│   ├── index.js       # 应用入口
│   ├── agent.js       # Agent 逻辑
│   └── utils.js       # 工具函数
├── .env.example       # 环境变量示例
├── Dockerfile         # 云托管部署配置
├── scf_bootstrap      # 云函数启动脚本
└── package.json       # 依赖配置
```
 
## 部署到 CloudBase

详细部署步骤请参考官方文档：[HTTP 云函数部署](https://docs.cloudbase.net/ai/agent-development/deployment/cloud-function)

## 自定义 Agent

修改 `src/agent.js` 中的 `systemPrompt` 可自定义 Agent 角色：

```javascript
systemPrompt: "你是一位精通云开发 CloudBase 的专家，擅长回答任何相关的问题。"
```
