import { getMissingModelConfig, resolveModelRuntimeConfig } from "./model-config.js";

/**
 * Express 中间件：检查必需的环境变量
 *
 * 在处理请求前验证“解析后的模型配置”是否完整。
 * 支持两种模式：
 * 1) 预设模式（MODEL_PRESET）
 * 2) 自定义模式（OPENAI_MODEL + OPENAI_BASE_URL）
 *
 * 如果缺少关键项则返回 503，避免后续调用失败。
 */
export function checkOpenAIEnvMiddleware(_req, res, next) {
  const modelConfig = resolveModelRuntimeConfig();
  const missingVars = getMissingModelConfig(modelConfig);

  // 缺少环境变量时返回 503，提示用户配置
  if (missingVars.length > 0) {
    res.status(503).json({
      error: "Service Unavailable",
      message: `Missing required environment variables: ${missingVars.join(", ")}`,
      code: "MISSING_ENV_CONFIG",
      detail: {
        preset: modelConfig.effectivePresetId,
        requiredApiKeyEnv: modelConfig.apiKeyEnvName,
      },
    });
    return;
  }

  next();
}

/**
 * 从标准 Web Request 的 Authorization header 中解析 JWT
 *
 * @param {Request} request - 标准 Web Request 对象
 * @returns {{ id: string, [key: string]: any } | null} 解析后的用户信息，失败返回 null
 *
 * @example
 * const userInfo = parseJwtFromRequest(request);
 * if (userInfo) {
 *   console.log(userInfo.id); // JWT 中的 sub 字段
 * }
 */
export function parseJwtFromRequest(request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return null;
    }

    // 支持 "Bearer <token>" 格式
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader;

    if (!token) {
      return null;
    }

    // JWT 格式: header.payload.signature
    const parts = token.split(".");
    if (parts.length !== 3) {
      return null;
    }

    // 解码 payload (第二部分)
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8"),
    );

    return {
      id: payload.sub,
      ...payload,
    };
  } catch {
    return null;
  }
}
