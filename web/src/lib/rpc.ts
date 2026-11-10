// Read-only contract views over raw JSON-RPC (browser-safe, CORS *).
// View results are a UTF-8 byte array; contract errors come back as HTTP 200 + result.error.

function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function viewCall<T>(rpcUrl: string, contractId: string, method: string, args: object = {}): Promise<T> {
  const res = await fetch(rpcUrl, {
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
  if (!res.ok) throw new Error(`RPC HTTP ${res.status} for ${method}`);
  const json = await res.json();
  if (json.error) {
    const cause = json.error.cause?.name ? `/${json.error.cause.name}` : "";
    throw new Error(`${method}: ${json.error.name ?? "RPC_ERROR"}${cause} ${json.error.data ?? json.error.message ?? ""}`.trim());
  }
  if (json.result?.error) throw new Error(`${method}: ${json.result.error}`);
  const bytes = new Uint8Array(json.result.result as number[]);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
