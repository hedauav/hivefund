// Read-only contract views over raw JSON-RPC (browser-safe, CORS *).
// View results are a UTF-8 byte array; contract errors come back as HTTP 200 + result.error.

function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// Public testnet RPCs that send CORS headers. A rate-limited endpoint can answer without CORS,
// which the browser reports as a network error, so transport failures fall over to the next one.
const FALLBACKS = ["https://near-testnet.drpc.org", "https://rpc.testnet.near.org"];
let preferred: string | null = null;

export async function viewCall<T>(rpcUrl: string, contractId: string, method: string, args: object = {}): Promise<T> {
  const urls = [...new Set([preferred, rpcUrl, ...(rpcUrl.includes("testnet") ? FALLBACKS : [])].filter((u): u is string => !!u))];
  let lastErr: unknown;
  for (const url of urls) {
    let res: Response;
    try {
      res = await post(url, contractId, method, args);
    } catch (e) {
      lastErr = e;
      continue;
    }
    if (!res.ok) {
      lastErr = new Error(`RPC HTTP ${res.status} for ${method}`);
      continue;
    }
    preferred = url;
    return decode<T>(await res.json(), method);
  }
  throw lastErr instanceof Error ? lastErr : new Error(`RPC unavailable for ${method}`);
}

function post(rpcUrl: string, contractId: string, method: string, args: object) {
  return fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "hivefund",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "optimistic",
        account_id: contractId,
        method_name: method,
        args_base64: toBase64(JSON.stringify(args)),
      },
    }),
    cache: "no-store",
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function decode<T>(json: any, method: string): T {
  if (json.error) {
    const cause = json.error.cause?.name ? `/${json.error.cause.name}` : "";
    throw new Error(`${method}: ${json.error.name ?? "RPC_ERROR"}${cause} ${json.error.data ?? json.error.message ?? ""}`.trim());
  }
  if (json.result?.error) throw new Error(`${method}: ${json.result.error}`);
  const bytes = new Uint8Array(json.result.result as number[]);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
