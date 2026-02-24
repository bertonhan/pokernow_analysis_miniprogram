import cloud from "wx-server-sdk";

const HISTORY_COLLECTION = process.env.AI_HISTORY_COLLECTION || "ai_bot_chat_history";
const TRACE_COLLECTION = process.env.AI_TRACE_COLLECTION || "ai_bot_chat_trace";
const MAX_PROMPT_TEXT = readIntEnv("AI_HISTORY_MAX_PROMPT_TEXT", 240000);
const MAX_OUTPUT_TEXT = readIntEnv("AI_HISTORY_MAX_OUTPUT_TEXT", 240000);

let dbInstance = null;

function readIntEnv(name, fallback) {
  const value = typeof process.env[name] === "string" ? process.env[name].trim() : "";
  if (!value) return fallback;
  const num = Number.parseInt(value, 10);
  return Number.isFinite(num) ? num : fallback;
}

function nowDate() {
  return new Date();
}

function clipText(value, maxLen) {
  const text = typeof value === "string" ? value : "";
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}\n...[truncated]`;
}

function sanitizeIdPart(value, maxLen) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  const normalized = text.replace(/[^a-zA-Z0-9_-]/g, "_");
  return normalized.slice(0, maxLen);
}

function sanitizeSimpleObject(value, depth = 0) {
  if (depth > 5) return "[max-depth]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return clipText(value, 4000);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitizeSimpleObject(item, depth + 1));
  if (typeof value === "object") {
    const out = {};
    Object.keys(value).slice(0, 40).forEach((key) => {
      out[key] = sanitizeSimpleObject(value[key], depth + 1);
    });
    return out;
  }
  return String(value);
}

function sanitizeMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list.slice(0, 20).map((msg, index) => {
    const item = msg && typeof msg === "object" ? msg : {};
    const role = typeof item.role === "string" ? item.role : "";
    const id = typeof item.id === "string" ? item.id : `msg-${index + 1}`;
    const content = typeof item.content === "string"
      ? clipText(item.content, MAX_PROMPT_TEXT)
      : sanitizeSimpleObject(item.content);
    return { id, role, content };
  });
}

function getDb() {
  if (dbInstance) return dbInstance;
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  dbInstance = cloud.database();
  return dbInstance;
}

function buildHistoryId(meta) {
  const agentPart = sanitizeIdPart(meta.agentId, 36) || "agent";
  const runPart = sanitizeIdPart(meta.runId, 72)
    || sanitizeIdPart(meta.threadId, 72)
    || `${Date.now()}`;
  return `${agentPart}_${runPart}`;
}

function buildHistoryStartDoc(meta) {
  const startedAt = nowDate();
  return {
    schemaVersion: 1,
    historyId: meta.historyId,
    agentId: meta.agentId || "",
    requestId: meta.requestId || "",
    threadId: meta.threadId || "",
    runId: meta.runId || "",
    sceneId: meta.sceneId || "",
    userId: meta.userId || "",
    status: "running",
    input: {
      messageCount: Array.isArray(meta.messages) ? meta.messages.length : 0,
      messages: sanitizeMessages(meta.messages),
      promptText: clipText(meta.promptText, MAX_PROMPT_TEXT),
      promptPreview: clipText(meta.promptText, 300),
      userMatchData: sanitizeSimpleObject(meta.userMatchData),
      clientState: sanitizeSimpleObject(meta.clientState),
    },
    output: {
      text: "",
      chars: 0,
      preview: "",
    },
    model: sanitizeSimpleObject(meta.model),
    traceStats: {
      count: 0,
      lastEventType: "REQUEST_RECEIVED",
    },
    error: null,
    startedAt,
    endedAt: null,
    createdAt: startedAt,
    updatedAt: startedAt,
  };
}

export async function createOrUpdateHistoryStart(meta) {
  const db = getDb();
  const historyId = buildHistoryId(meta || {});
  const doc = buildHistoryStartDoc({
    ...(meta || {}),
    historyId,
  });

  try {
    await db.collection(HISTORY_COLLECTION).doc(historyId).set({ data: doc });
  } catch (err) {
    await db.collection(HISTORY_COLLECTION).doc(historyId).update({
      data: {
        status: "running",
        input: doc.input,
        output: doc.output,
        model: doc.model,
        traceStats: doc.traceStats,
        error: null,
        startedAt: doc.startedAt,
        endedAt: null,
        updatedAt: doc.updatedAt,
      },
    });
  }

  return historyId;
}

export async function appendTraceEvent(meta) {
  const db = getDb();
  const eventAt = nowDate();
  const data = {
    schemaVersion: 1,
    historyId: meta.historyId || "",
    requestId: meta.requestId || "",
    threadId: meta.threadId || "",
    runId: meta.runId || "",
    agentId: meta.agentId || "",
    sequence: Number.isFinite(Number(meta.sequence)) ? Number(meta.sequence) : 0,
    level: meta.level || "info",
    eventType: meta.eventType || "UNKNOWN",
    payload: sanitizeSimpleObject(meta.payload),
    createdAt: eventAt,
    eventAt,
  };
  await db.collection(TRACE_COLLECTION).add({ data });
}

export async function markHistoryCompleted(meta) {
  const db = getDb();
  const outputText = clipText(meta.outputText, MAX_OUTPUT_TEXT);
  const endedAt = nowDate();
  await db.collection(HISTORY_COLLECTION).doc(meta.historyId).update({
    data: {
      status: "completed",
      output: {
        text: outputText,
        chars: outputText.length,
        preview: clipText(outputText, 500),
      },
      traceStats: {
        count: Number.isFinite(Number(meta.traceCount)) ? Number(meta.traceCount) : 0,
        lastEventType: meta.lastEventType || "RUN_FINISHED",
      },
      runMetrics: sanitizeSimpleObject(meta.runMetrics),
      error: null,
      endedAt,
      updatedAt: endedAt,
      durationMs: Number.isFinite(Number(meta.durationMs)) ? Number(meta.durationMs) : 0,
    },
  });
}

export async function markHistoryFailed(meta) {
  const db = getDb();
  const endedAt = nowDate();
  await db.collection(HISTORY_COLLECTION).doc(meta.historyId).update({
    data: {
      status: "failed",
      traceStats: {
        count: Number.isFinite(Number(meta.traceCount)) ? Number(meta.traceCount) : 0,
        lastEventType: meta.lastEventType || "RUN_ERROR",
      },
      error: sanitizeSimpleObject(meta.error),
      endedAt,
      updatedAt: endedAt,
      durationMs: Number.isFinite(Number(meta.durationMs)) ? Number(meta.durationMs) : 0,
    },
  });
}
