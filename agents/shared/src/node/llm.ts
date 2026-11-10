// NEAR AI Cloud (OpenAI-compatible) chat helper. Returns null when no key is configured (or in mock mode),
// so callers fall back to deterministic logic and record mode "fallback" honestly.
import OpenAI from "openai";
import { getMode, loadEnv } from "./config.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOpts {
  /** Ask for a JSON object response. */
  json?: boolean;
  /** JSON Schema for structured output (tries json_schema, falls back to json_object). */
  schema?: Record<string, unknown>;
  schemaName?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export const DEFAULT_NEARAI_BASE_URL = "https://cloud-api.near.ai/v1";
export const DEFAULT_NEARAI_MODEL = "z-ai/glm-5.3-flash";

let client: OpenAI | null = null;
let lastError: string | null = null;

export function llmAvailable(): boolean {
  loadEnv();
  return Boolean(process.env.NEARAI_API_KEY) && getMode() !== "mock";
}

export function llmModel(): string {
  loadEnv();
  return process.env.NEARAI_MODEL || DEFAULT_NEARAI_MODEL;
}

/** Last LLM error message (for reports that fell back). */
export function llmLastError(): string | null {
  return lastError;
}

function getClient(): OpenAI | null {
  if (!llmAvailable()) return null;
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.NEARAI_API_KEY!,
      baseURL: process.env.NEARAI_BASE_URL || DEFAULT_NEARAI_BASE_URL,
      timeout: 60_000,
      maxRetries: 2,
    });
  }
  return client;
}

/** Chat completion text, or null if no key / the call failed (callers must fall back). */
export async function chat(messages: ChatMessage[], opts: ChatOpts = {}): Promise<string | null> {
  const c = getClient();
  if (!c) return null;
  const base = {
    model: opts.model ?? llmModel(),
    messages,
    temperature: opts.temperature ?? 0,
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
  };
  const formats: unknown[] = [];
  if (opts.schema) {
    formats.push({ type: "json_schema", json_schema: { name: opts.schemaName ?? "result", schema: opts.schema, strict: true } });
  }
  if (opts.json || opts.schema) formats.push({ type: "json_object" });
  formats.push(undefined);
  for (const fmt of formats) {
    try {
      const res = await c.chat.completions.create({ ...base, ...(fmt ? { response_format: fmt as never } : {}) } as never);
      const text = (res as { choices?: { message?: { content?: string | null } }[] }).choices?.[0]?.message?.content ?? null;
      if (text) {
        lastError = null;
        return text;
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      // 400 on response_format: try the next format; anything else: give up
      if (!/response_format|json_schema|400|unsupported/i.test(lastError)) return null;
    }
  }
  return null;
}

/** Chat + JSON.parse (tolerates ```json fences). null on no key / failure / unparsable output. */
export async function chatJson<T = unknown>(messages: ChatMessage[], opts: ChatOpts = {}): Promise<T | null> {
  const text = await chat(messages, { ...opts, json: true });
  if (text == null) return null;
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {
        /* fall through */
      }
    }
    lastError = "LLM returned non-JSON output";
    return null;
  }
}
