// Minimal structural interfaces this package needs from @hivefund/shared/node (Stream B).
// Declared locally so workers/verifier compile and test independently; Stream B's NearHubClient,
// MockHubClient and store satisfy them structurally.
import type { OffchainKind, StrategyChange } from "@hivefund/shared";

export interface HubLike {
  view<T = unknown>(method: string, args?: Record<string, unknown>): Promise<T>;
  call(
    method: string,
    args: Record<string, unknown>,
    opts?: { gasTGas?: number; depositYocto?: string },
  ): Promise<{ txHash: string; result: any }>;
}

export interface StoreMeta {
  kind: OffchainKind;
  bounty_id?: number;
  round?: number;
  actor: string;
}

export interface StoreLike {
  /** Writes canonical JSON content-addressed; returns sha256 hex hash. */
  put(obj: unknown, meta: StoreMeta): string | Promise<string>;
  /** Reads by hash (re-hashes and throws on mismatch). */
  get(hash: string): unknown;
  appendStrategy?(worker: string, change: StrategyChange): unknown;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  /** JSON schema the answer must follow (sent as response_format json_schema, fallback json_object). */
  schema?: { name: string; schema: Record<string, unknown>; strict?: boolean };
  /**
   * "json_schema" (default when a schema is given): constrained structured output.
   * "json_object": JSON mode with the schema in the prompt. Use for long free-form content (source code):
   * GLM-5.3 under constrained decoding tends to emit placeholder skeletons ("...") for such fields.
   */
  format?: "json_schema" | "json_object";
  maxTokens?: number;
  temperature?: number;
}

/** An LLM that returns parsed JSON. `chat` throws on transport/parse errors. */
export interface LlmClient {
  model: string;
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<unknown>;
}
