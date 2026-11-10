// NEAR AI Cloud (OpenAI-compatible) chat helper. Returns null when no key is configured (or in mock mode)
// or when the call fails, so callers fall back to deterministic logic and record mode "fallback" honestly.
// The API key is never logged.
import OpenAI from "openai";
import { getMode, loadEnv } from "./config.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOpts {
  /** Ask for a JSON object response (response_format json_object). */
  json?: boolean;
  /** JSON Schema for strict structured output (response_format json_schema; falls back to json_object). */
  schema?: Record<string, unknown>;
  schemaName?: string;
  /** Per-call model override (default NEARAI_MODEL || z-ai/glm-5.3-flash). */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /**
   * Reasoning control. Default: thinking disabled (`chat_template_kwargs.enable_thinking=false`) because
   * GLM-5.3-flash otherwise spends max_tokens on reasoning and returns empty content.
   * Pass a number to allow a bounded reasoning budget instead (`thinking_token_budget`).
   */
  thinkingTokenBudget?: number;
}

export interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ChatResult {
  /** assistant message content (reasoning fields are ignored) */
  content: string;
  /** model that answered (as reported by the API) */
  model: string;
  usage: ChatUsage | null;
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

/** Last LLM error message (for reports that fell back). Never contains the key. */
export function llmLastError(): string | null {
  return lastError;
}

function getClient(): OpenAI | null {
  if (!llmAvailable()) return null;
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.NEARAI_API_KEY!,
      baseURL: process.env.NEARAI_BASE_URL || DEFAULT_NEARAI_BASE_URL,
      timeout: 90_000,
      maxRetries: 2,
    });
  }
  return client;
}

function scrub(msg: string): string {
  const key = process.env.NEARAI_API_KEY;
  return key ? msg.split(key).join("<redacted>") : msg;
}

/** Chat completion, or null if no key / the call failed / empty content (callers must fall back). */
export async function chat(messages: ChatMessage[], opts: ChatOpts = {}): Promise<ChatResult | null> {
  const c = getClient();
  if (!c) return null;
  const reasoning =
    opts.thinkingTokenBudget != null
      ? { thinking_token_budget: opts.thinkingTokenBudget }
      : { chat_template_kwargs: { enable_thinking: false } };
  const base = {
    model: opts.model ?? llmModel(),
    messages,
    temperature: opts.temperature ?? 0,
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    ...reasoning,
  };
  const formats: (Record<string, unknown> | undefined)[] = [];
  if (opts.schema) {
    formats.push({ type: "json_schema", json_schema: { name: opts.schemaName ?? "result", schema: opts.schema, strict: true } });
  }
  if (opts.json || opts.schema) formats.push({ type: "json_object" });
  else formats.push(undefined);
  for (const fmt of formats) {
    try {
      const res = (await c.chat.completions.create({
        ...base,
        ...(fmt ? { response_format: fmt } : {}),
      } as never)) as unknown as {
        model?: string;
        usage?: ChatUsage;
        choices?: { message?: { content?: string | null } }[];
      };
      const content = res.choices?.[0]?.message?.content ?? "";
      if (content.trim()) {
        lastError = null;
        return { content, model: res.model ?? base.model, usage: res.usage ?? null };
      }
      lastError = "LLM returned empty content";
    } catch (e) {
      lastError = scrub(e instanceof Error ? e.message : String(e));
      // response_format not supported: try the next format; anything else: give up
      if (!/response_format|json_schema|400|unsupported/i.test(lastError)) return null;
    }
  }
  return null;
}

export interface ChatJsonResult<T> extends Omit<ChatResult, "content"> {
  data: T;
  content: string;
}

/** Chat + JSON.parse (tolerates ```json fences). null on no key / failure / unparsable output. */
export async function chatJsonFull<T = unknown>(messages: ChatMessage[], opts: ChatOpts = {}): Promise<ChatJsonResult<T> | null> {
  const r = await chat(messages, { ...opts, json: true });
  if (!r) return null;
  const data = parseJsonLoose<T>(r.content);
  if (data === undefined) {
    lastError = "LLM returned non-JSON output";
    return null;
  }
  return { ...r, data };
}

/** Convenience: just the parsed JSON (or null). */
export async function chatJson<T = unknown>(messages: ChatMessage[], opts: ChatOpts = {}): Promise<T | null> {
  return (await chatJsonFull<T>(messages, opts))?.data ?? null;
}

export function parseJsonLoose<T>(text: string): T | undefined {
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
  }
  return undefined;
}
