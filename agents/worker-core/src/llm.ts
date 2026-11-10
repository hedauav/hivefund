// NEAR AI Cloud client (OpenAI-compatible Chat Completions over fetch, no SDK dependency).
// Docs: https://docs.near.ai  — base URL https://cloud-api.near.ai/v1, default model z-ai/glm-5.3-flash.
// Tries response_format json_schema first, falls back to json_object (+schema in prompt) if rejected.
import type { ChatMessage, ChatOptions, LlmClient } from "./ports.ts";

export const DEFAULT_NEARAI_BASE_URL = "https://cloud-api.near.ai/v1";
export const DEFAULT_NEARAI_MODEL = "z-ai/glm-5.3-flash";

export interface NearAiOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** default max_tokens for the visible answer */
  maxTokens?: number;
  /**
   * Reasoning control. Default false: sends chat_template_kwargs {enable_thinking:false} (GLM-5.3 otherwise
   * spends the whole max_tokens on hidden reasoning and returns empty content). When true, the model reasons
   * within thinkingTokenBudget and max_tokens is raised above it so the answer still fits.
   */
  enableThinking?: boolean;
  /** GLM reasoning cap (non-OpenAI extension), only used when enableThinking is true */
  thinkingTokenBudget?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function createNearAiClient(o: NearAiOptions): LlmClient {
  const baseUrl = (o.baseUrl ?? DEFAULT_NEARAI_BASE_URL).replace(/\/+$/, "");
  const model = o.model ?? DEFAULT_NEARAI_MODEL;
  const doFetch = o.fetchImpl ?? fetch;
  let jsonSchemaSupported = true;

  async function post(body: Record<string, unknown>): Promise<{ status: number; json: any; text: string }> {
    const res = await doFetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${o.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(o.timeoutMs ?? 90_000),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON error body */
    }
    return { status: res.status, json, text };
  }

  return {
    model,
    async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<unknown> {
      const base: Record<string, unknown> = {
        model,
        messages,
        temperature: opts.temperature ?? 0,
        max_tokens: opts.maxTokens ?? o.maxTokens ?? 2000,
      };
      if (o.enableThinking) {
        const budget = o.thinkingTokenBudget ?? 1024;
        base.thinking_token_budget = budget;
        base.max_tokens = (base.max_tokens as number) + budget;
      } else {
        base.chat_template_kwargs = { enable_thinking: false };
      }

      let r: { status: number; json: any; text: string } | null = null;
      if (opts.schema && jsonSchemaSupported && opts.format !== "json_object") {
        r = await post({
          ...base,
          response_format: {
            type: "json_schema",
            json_schema: { name: opts.schema.name, strict: opts.schema.strict ?? true, schema: opts.schema.schema },
          },
        });
        if (r.status === 400 || r.status === 422) {
          jsonSchemaSupported = false; // model/gateway rejected structured outputs; use json_object from now on
          r = null;
        }
      }
      if (!r) {
        const msgs = opts.schema
          ? [
              ...messages,
              {
                role: "system" as const,
                content: `Respond with a single JSON object matching this JSON Schema:\n${JSON.stringify(opts.schema.schema)}`,
              },
            ]
          : messages;
        r = await post({ ...base, messages: msgs, response_format: { type: "json_object" } });
      }
      if (r.status < 200 || r.status >= 300) {
        throw new Error(`NEAR AI HTTP ${r.status}: ${r.text.slice(0, 300)}`);
      }
      const content: unknown = r.json?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.trim() === "") {
        throw new Error("NEAR AI returned empty content");
      }
      return parseJsonContent(content);
    },
  };
}

/** Parse model output as JSON, tolerating ```json fences or leading prose. */
export function parseJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced ? fenced[1]!.trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error("NEAR AI content is not valid JSON");
  }
}

/**
 * LLM client from env: NEARAI_API_KEY (required), NEARAI_BASE_URL, NEARAI_MODEL (or overrides.model).
 * Returns null when no key is configured -> callers use their deterministic fallback and record mode "fallback".
 */
export function nearAiFromEnv(
  overrides: Partial<NearAiOptions> = {},
  env: Record<string, string | undefined> = process.env,
): LlmClient | null {
  const apiKey = overrides.apiKey ?? env.NEARAI_API_KEY;
  if (!apiKey) return null;
  return createNearAiClient({
    apiKey,
    baseUrl: overrides.baseUrl ?? (env.NEARAI_BASE_URL || DEFAULT_NEARAI_BASE_URL),
    model: overrides.model ?? (env.NEARAI_MODEL || DEFAULT_NEARAI_MODEL),
    maxTokens: overrides.maxTokens,
    enableThinking: overrides.enableThinking ?? false,
    thinkingTokenBudget: overrides.thinkingTokenBudget,
    timeoutMs: overrides.timeoutMs,
    fetchImpl: overrides.fetchImpl,
  });
}
