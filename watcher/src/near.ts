const TESTNET_RPC = "https://rpc.testnet.near.org";

type RpcResponse = {
  result?: { result?: number[] };
  error?: { message?: string; data?: unknown };
};

export async function viewCall<T>(
  contractId: string,
  method: string,
  args: Record<string, unknown>,
): Promise<T> {
  const body = {
    jsonrpc: "2.0",
    id: "guardia",
    method: "query",
    params: {
      request_type: "call_function",
      finality: "final",
      account_id: contractId,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    },
  };

  const res = await fetch(TESTNET_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as RpcResponse;
  if (json.error) {
    throw new Error(json.error.message ?? JSON.stringify(json.error));
  }
  const bytes = json.result?.result ?? [];
  const text = Buffer.from(bytes).toString("utf8");
  return JSON.parse(text) as T;
}
